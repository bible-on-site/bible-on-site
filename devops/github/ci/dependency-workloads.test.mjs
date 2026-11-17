import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/dependency-submission.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");
const step = workflow
	.split("      - name: 'Install MAUI Android workload'\n")[1]
	?.split("      - name: ")[0];
assert.ok(step);
const script = step
	.split("        run: |\n")[1]
	.split("\n")
	.map((line) => {
		assert.ok(!line.trim() || line.startsWith("          "));
		return line.slice(10);
	})
	.join("\n");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const shellPath = (path) =>
	path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function fixture({ sdk = "10.0.403", fail = "", feedBand, feed, feedStatus, set } = {}, run) {
	const directory = mkdtempSync(join(tmpdir(), "dependency-workloads-"));
	const bin = join(directory, "bin"),
		installation = join(directory, "dotnet"),
		manifests = join(installation, "sdk-manifests"),
		commands = join(directory, "commands"),
		selected = join(directory, "selected-set");
	mkdirSync(bin);
	for (const band of ["8.0.100", "10.0.400", "11.0.100", "11.0.200"])
		mkdirSync(join(manifests, band), { recursive: true });
	writeFileSync(join(manifests, "README"), "keep non-directory entries");
	writeFileSync(join(directory, "global.json"), JSON.stringify({ sdk: { version: sdk } }));
	writeFileSync(
		join(bin, "dotnet"),
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$WORKLOAD_TEST_COMMANDS"
if [ "$*" = --version ]; then
  [ "$WORKLOAD_TEST_FAIL" != version ] || exit 44
  "$WORKLOAD_TEST_NODE" -p 'JSON.parse(require("fs").readFileSync("global.json", "utf8")).sdk.version'
elif [ "$*" = 'workload update' ]; then
  [ "$WORKLOAD_TEST_FAIL" != update ] || exit 45
  printf '%s\\n' "\${WORKLOAD_TEST_SET:-}" > "$WORKLOAD_TEST_SELECTED"
elif [ "\${1:-}" = 'workload' ] && [ "\${2:-}" = 'install' ] && [ "\${3:-}" = 'maui-android' ]; then
  [ "$WORKLOAD_TEST_FAIL" != install ] || exit 47
  if [ "\${4:-}" = '--version' ]; then
    printf '%s\\n' "\${5:?pinned install requires a workload set}" > "$WORKLOAD_TEST_SELECTED"
  else
    [ -f "$WORKLOAD_TEST_SELECTED" ] || exit 46
  fi
else
  printf 'Unexpected or fabricated workload command: %s\\n' "$*" >&2
  exit 48
fi
`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(bin, "curl"),
		`#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
printf 'curl %s\\n' "$url" >> "$WORKLOAD_TEST_COMMANDS"
[ "\${WORKLOAD_TEST_FAIL:-}" != curl ] || exit 7
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = '-o' ]; then out="$arg"; fi
  prev="$arg"
done
case "$url" in
  *"microsoft.net.workloads.\${WORKLOAD_TEST_FEED_BAND:-unpublished}/index.json")
    printf '%s\\n' "\${WORKLOAD_TEST_FEED:-{\\"versions\\":[]}}" > "$out"
    printf '%s' "\${WORKLOAD_TEST_FEED_STATUS:-200}"
    ;;
  *)
    : > "$out"
    printf '%s' "\${WORKLOAD_TEST_FEED_STATUS:-404}"
    ;;
esac
`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(bin, "sudo"),
		`#!/usr/bin/env bash
set -euo pipefail
[ "$#" = 4 ] && [ "$1" = rm ] && [ "$2" = -rf ] && [ "$3" = -- ] || exit 49
case "$4" in
  "$DOTNET_ROOT/sdk-manifests/"*) exec "$@" ;;
  *) exit 50 ;;
esac
`,
		{ mode: 0o755 },
	);
	try {
		run({
			directory,
			manifests,
			commands,
			selected,
			execute: (extra = {}) =>
				spawnSync(shell, ["-e", "-o", "pipefail", "-c", `export PATH="$WORKLOAD_TEST_BIN:$PATH"\n${script}`], {
					cwd: directory,
					encoding: "utf8",
					env: {
						...process.env,
						DOTNET_ROOT: shellPath(installation),
						WORKLOAD_TEST_BIN: shellPath(bin),
						WORKLOAD_TEST_NODE: shellPath(process.execPath),
						WORKLOAD_TEST_COMMANDS: shellPath(commands),
						WORKLOAD_TEST_SELECTED: shellPath(selected),
						WORKLOAD_TEST_SET: set ?? (sdk.startsWith("10.") ? "10.0.404" : "11.0.100.1"),
						WORKLOAD_TEST_FEED_BAND: feedBand ?? (sdk.startsWith("10.") ? "10.0.400" : "11.0.100"),
						WORKLOAD_TEST_FEED: feed ?? (sdk.startsWith("10.")
							? '{"versions":["10.400.0","10.400.1","10.401.0","10.401.1","10.402.0","10.402.1","10.403.0","10.404.0"]}'
							: '{"versions":["11.100.0","11.100.1"]}'),
						WORKLOAD_TEST_FEED_STATUS: feedStatus ?? "",
						WORKLOAD_TEST_FAIL: fail,
						...extra,
					},
				}),
		});
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
		assert.ok(basename(directory).startsWith("dependency-workloads-"));
		rmSync(directory, { recursive: true, force: true });
	}
}

for (const source of ["base", "head"])
	for (const [sdk, band, set] of [
		["10.0.403", "10.0.400", "10.0.404.0"],
		["11.0.100", "11.0.100", "11.0.100.1"],
	])
		test(`${source} snapshot SDK ${sdk} preserves ${band} and pins its newest published workload set`, () =>
			fixture({ sdk }, (f) => {
				const result = f.execute({ SNAPSHOT_SOURCE: source });
				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(readdirSync(f.manifests).sort(), [band, "README"]);
				assert.equal(readFileSync(f.selected, "utf8").trim(), set);
				assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), [
					"--version",
					`curl https://api.nuget.org/v3-flatcontainer/microsoft.net.workloads.${band}/index.json`,
					"workload update",
					`workload install maui-android --version ${set}`,
				]);
			}));

test("a band without a published workload set falls back to implicit resolution", () =>
	// Pre-8.0.400 SDK bands have no microsoft.net.workloads.<band> package.
	fixture({ sdk: "8.0.300", feedBand: "", set: "" }, (f) => {
		const result = f.execute();
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(readdirSync(f.manifests).sort(), ["README"]);
		assert.equal(readFileSync(f.selected, "utf8").trim(), "");
		assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), [
			"--version",
			"curl https://api.nuget.org/v3-flatcontainer/microsoft.net.workloads.8.0.300/index.json",
			"workload update",
			"workload install maui-android",
		]);
	}));

for (const [name, extra, pattern] of [
	["a workload-set feed transport error fails loudly", { fail: "curl" }, /feed request for band 10\.0\.400 failed/],
	["a workload-set feed server error fails loudly", { feedStatus: "503" }, /lookup for band 10\.0\.400 failed: HTTP 503/],
	["a version-less workload-set feed fails loudly", { feed: '{"versions":[]}' }, /feed for band 10\.0\.400 listed no versions/],
])
	test(name, () =>
		fixture(extra, (f) => {
			const result = f.execute();
			assert.notEqual(result.status, 0, result.stderr);
			assert.match(result.stderr, pattern);
			// The lookup fails before any install but after the band pruning.
			assert.deepEqual(readdirSync(f.manifests).sort(), ["10.0.400", "README"]);
			assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), [
				"--version",
				"curl https://api.nuget.org/v3-flatcontainer/microsoft.net.workloads.10.0.400/index.json",
			]);
		}));

test("invalid SDK output fails before deleting any manifest or installing a workload", () =>
	fixture({ sdk: "not-an-sdk" }, (f) => {
		const before = readdirSync(f.manifests);
		const result = f.execute();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unsupported .NET SDK version/);
		assert.deepEqual(readdirSync(f.manifests), before);
		assert.equal(readFileSync(f.commands, "utf8").trim(), "--version");
		assert.equal(existsSync(f.selected), false);
	}));

test("missing installation root fails without deleting manifests", () =>
	fixture({}, (f) => {
		const before = readdirSync(f.manifests);
		const result = f.execute({ DOTNET_ROOT: "" });
		assert.notEqual(result.status, 0);
		assert.deepEqual(readdirSync(f.manifests), before);
		assert.equal(existsSync(f.selected), false);
	}));

for (const [stage, status, commands] of [
	["version", 44, ["--version"]],
	["update", 45, [
		"--version",
		"curl https://api.nuget.org/v3-flatcontainer/microsoft.net.workloads.10.0.400/index.json",
		"workload update",
	]],
	["install", 47, [
		"--version",
		"curl https://api.nuget.org/v3-flatcontainer/microsoft.net.workloads.10.0.400/index.json",
		"workload update",
		"workload install maui-android --version 10.0.404.0",
	]],
])
	test(`${stage} failure propagates without retrying or running later commands`, () =>
		fixture({ fail: stage }, (f) => {
			const result = f.execute();
			assert.equal(result.status, status, result.stderr);
			assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), commands);
		}));
