import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/app-push-daily.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");
const script = workflow
	.split("        run: |\n")[1]
	.trimEnd()
	.split("\n")
	.map((line) => line.slice(10))
	.join("\n");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
// Native Windows jq otherwise translates embedded LF to CRLF; the runner
// uses Linux jq and must preserve the input's exact bytes.
const mock = `${process.platform === "win32" ? 'jq() { command jq --binary "$@"; }' : ""}
curl() {
  printf '%s\\0' "$@" > "$CURL_ARGUMENTS"
  printf '{"sent":1}\\n'
}
`;

function run(event, eventName = "workflow_dispatch", curl = mock) {
	const directory = mkdtempSync(join(tmpdir(), "app-push-daily-"));
	const eventPath = join(directory, "event.json");
	const argsPath = join(directory, "curl-arguments");
	writeFileSync(
		eventPath,
		typeof event === "string" ? event : JSON.stringify(event),
	);
	try {
		const result = spawnSync(
			shell,
			["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", curl + script],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GITHUB_EVENT_NAME: eventName,
					GITHUB_EVENT_PATH: eventPath.split("\\").join("/"),
					CURL_ARGUMENTS: argsPath.split("\\").join("/"),
					PUSH_SEND_SECRET: "test-send-secret",
					SITE_ORIGIN: "https://example.test",
				},
			},
		);
		return {
			...result,
			args: existsSync(argsPath)
				? readFileSync(argsPath, "utf8").split("\0").slice(0, -1)
				: [],
		};
	} finally {
		assert.ok(directory.startsWith(join(tmpdir(), "app-push-daily-")));
		rmSync(directory, { recursive: true, force: true });
	}
}

test("masks the manual token and sends only that device", () => {
	const token = "fcm-device-token-0123456789";
	const result = run({ inputs: { token } });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, `::add-mask::${token}\n{"sent":1}\n`);
	assert.equal(result.stderr, "");
	assert.deepEqual(JSON.parse(result.args[result.args.indexOf("--data") + 1]), {
		token,
	});
	assert.ok(result.args.includes("Authorization: Bearer test-send-secret"));
	assert.equal(result.args.at(-1), "https://example.test/api/push/device/daily");
	// A step env value is printed before any run-script masking takes effect.
	assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.token\s*\}\}/);
});

test("encodes manual input as JSON and prevents logging command injection", () => {
	const token = 'fcm-token%20"\\\r\n::warning::private';
	const result = run({ inputs: { token } });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.args[result.args.indexOf("--data") + 1]), {
		token,
	});
	const escaped = token
		.split("%")
		.join("%25")
		.split("\r")
		.join("%0D")
		.split("\n")
		.join("%0A");
	assert.equal(result.stdout, `::add-mask::${escaped}\n{"sent":1}\n`);
	assert.equal(result.stderr, "");
});

for (const event of [
	{},
	{ inputs: {} },
	{ inputs: { token: "" } },
	{ inputs: { token: null } },
	{ inputs: { token: 42 } },
]) {
	test(`rejects invalid manual input before a network request: ${JSON.stringify(event)}`, () => {
		const result = run(event);
		assert.equal(result.status, 4, result.stderr);
		assert.deepEqual(result.args, []);
		assert.equal(result.stdout, "");
	});
}

test("rejects malformed event JSON before a network request", () => {
	const result = run('{"inputs":');
	assert.notEqual(result.status, 0);
	assert.deepEqual(result.args, []);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /parse error/);
});

test("fails the run when the route reports a failed broadcast (#3499)", () => {
	// The route answers 502 on a total send failure; curl --fail-with-body
	// exits 22 and the step must stay red, printing the counts body.
	const result = run(
		{},
		"schedule",
		`curl() {
  printf '%s\\0' "$@" > "$CURL_ARGUMENTS"
  printf '{"perekId":1,"sent":0,"removed":0,"failed":1}\\n'
  return 22
}
`,
	);
	assert.equal(result.status, 22);
	assert.equal(
		result.stdout,
		'{"perekId":1,"sent":0,"removed":0,"failed":1}\n',
	);
});

test("retains the bodyless broadcast and arm gate for scheduled sends", () => {
	const result = run({}, "schedule");
	assert.equal(result.status, 0, result.stderr);
	assert.ok(!result.args.includes("--data"));
	assert.equal(result.stdout, '{"sent":1}\n');
	assert.match(
		workflow,
		/if: github\.event_name == 'workflow_dispatch' \|\| vars\.APP_PUSH_ENABLED == 'true'/,
	);
});
