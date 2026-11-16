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

function fixture({ sdk = "10.0.403", fail = "" } = {}, run) {
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
  # SDK 10.0.403 resolves a published set without inventing nonexistent 10.0.403.1.
  printf '%s\\n' "$WORKLOAD_TEST_SET" > "$WORKLOAD_TEST_SELECTED"
elif [ "$*" = 'workload install maui-android' ]; then
  [ -f "$WORKLOAD_TEST_SELECTED" ] || exit 46
  [ "$WORKLOAD_TEST_FAIL" != install ] || exit 47
else
  printf 'Unexpected or fabricated workload command: %s\\n' "$*" >&2
  exit 48
fi
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
						WORKLOAD_TEST_SET: sdk.startsWith("10.") ? "10.0.404" : "11.0.100.1",
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
		["10.0.403", "10.0.400", "10.0.404"],
		["11.0.100", "11.0.100", "11.0.100.1"],
	])
		test(`${source} snapshot SDK ${sdk} preserves ${band} and uses its resolved workload set`, () =>
			fixture({ sdk }, (f) => {
				const result = f.execute({ SNAPSHOT_SOURCE: source });
				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(readdirSync(f.manifests).sort(), [band, "README"]);
				assert.equal(readFileSync(f.selected, "utf8").trim(), set);
				assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), [
					"--version",
					"workload update",
					"workload install maui-android",
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
	["update", 45, ["--version", "workload update"]],
	["install", 47, ["--version", "workload update", "workload install maui-android"]],
])
	test(`${stage} failure propagates without retrying or running later commands`, () =>
		fixture({ fail: stage }, (f) => {
			const result = f.execute();
			assert.equal(result.status, status, result.stderr);
			assert.deepEqual(readFileSync(f.commands, "utf8").trim().split("\n"), commands);
		}));
