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
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const script = fileURLToPath(new URL("./free-large-packages.sh", import.meta.url));
const unix = (value) =>
	process.platform === "win32"
		? "/" + value[0].toLowerCase() + value.slice(2).replace(/\\/g, "/")
		: value;

function cleanup(t, inventory, changes = {}) {
	const dir = mkdtempSync(join(tmpdir(), "free-large-packages-"));
	t.after(() => {
		const target = resolve(dir);
		assert.equal(dirname(target), resolve(tmpdir()));
		assert.ok(basename(target).startsWith("free-large-packages-"));
		rmSync(target, { recursive: true, force: true });
	});
	const trace = join(dir, "trace");
	const commands = {
		"dpkg-query":
			'if [ "$CLEANUP_DPKG_EXIT" != 0 ]; then exit "$CLEANUP_DPKG_EXIT"; fi; printf "%s\\n" "$CLEANUP_INVENTORY"',
		sudo: 'exec "$@"',
		"apt-get": [
			'printf "%s\\n" "$*" >> "$CLEANUP_TRACE"',
			'if [ "$1" = "$CLEANUP_FAIL_ACTION" ]; then exit 37; fi',
			'if [ "$1" = remove ]; then',
			"  shift",
			'  for package in "$@"; do',
			'    case "$package" in -y|--fix-missing|--) continue;; esac',
			'    case " $CLEANUP_AVAILABLE " in',
			'      *" $package "*) ;;',
			'      *) printf "E: Unable to locate package %s\\n" "$package" >&2; exit 100;;',
			"    esac",
			"  done",
			"fi",
		].join("\n"),
	};
	for (const [name, body] of Object.entries(commands)) {
		writeFileSync(join(dir, name), "#!/bin/sh\n" + body + "\n", {
			mode: 0o755,
		});
	}
	const result = spawnSync(
		shell,
		[
			"--noprofile",
			"--norc",
			"-c",
			'export PATH="$CLEANUP_BIN:$PATH"; exec bash "$CLEANUP_SCRIPT"',
		],
		{
			encoding: "utf8",
			timeout: 5000,
			env: {
				...process.env,
				BASH_ENV: "",
				CLEANUP_BIN: unix(dir),
				CLEANUP_SCRIPT: unix(script),
				CLEANUP_TRACE: unix(trace),
				CLEANUP_INVENTORY: inventory
					.map(([name, state]) => name + "\t" + state)
					.join("\n"),
				CLEANUP_AVAILABLE: inventory
					.filter(([, state]) => state === "installed")
					.map(([name]) => name)
					.join(" "),
				CLEANUP_DPKG_EXIT: "0",
				CLEANUP_FAIL_ACTION: "",
				...changes,
			},
		},
	);
	assert.ifError(result.error);
	return {
		result,
		commands: existsSync(trace)
			? readFileSync(trace, "utf8").trim().split("\n")
			: [],
	};
}

test("a missing optional package does not prevent removal of installed large packages", (t) => {
	const targets = [
		"azure-cli",
		"google-chrome-stable",
		"firefox",
		"mono-devel",
		"libgl1-mesa-dri:amd64",
		"llvm-20",
		"php8.4-cli",
		"mongodb-org",
		"mysql-client-8.4",
		"dotnet-sdk-10.0",
		"aspnetcore-runtime-10.0",
		"google-cloud-cli",
	];
	const inventory = [
		...targets.map((name) => [name, "installed"]),
		["libc6:amd64", "installed"],
		["libssl-dev", "installed"],
		["libgtk-3-0t64:amd64", "installed"],
		["powershell", "config-files"],
		["google-cloud-sdk", "not-installed"],
	];
	const f = cleanup(t, inventory);
	assert.equal(f.result.status, 0, f.result.stderr);
	const removal = f.commands[0].split(" ");
	assert.deepEqual(removal.slice(0, 4), [
		"remove",
		"-y",
		"--fix-missing",
		"--",
	]);
	assert.deepEqual(removal.slice(4), targets);
	assert.deepEqual(f.commands.slice(1), ["autoremove -y", "clean"]);
});

test("an empty target set preserves unrelated packages and still cleans apt caches", (t) => {
	const f = cleanup(t, [
		["libc6:arm64", "installed"],
		["libgl1-mesa-dri:arm64", "config-files"],
	]);
	assert.equal(f.result.status, 0, f.result.stderr);
	assert.deepEqual(f.commands, ["autoremove -y", "clean"]);
});

test("older image package names are removed when they are installed", (t) => {
	const f = cleanup(t, [
		["powershell", "installed"],
		["google-cloud-sdk", "installed"],
		["google-cloud-cli", "config-files"],
	]);
	assert.equal(f.result.status, 0, f.result.stderr);
	assert.equal(
		f.commands[0],
		"remove -y --fix-missing -- powershell google-cloud-sdk",
	);
});

test("a package inventory failure stops before any privileged operation", (t) => {
	const f = cleanup(t, [], { CLEANUP_DPKG_EXIT: "23" });
	assert.equal(f.result.status, 23, f.result.stderr);
	assert.deepEqual(f.commands, []);
});

for (const action of ["remove", "autoremove", "clean"]) {
	test("an apt " + action + " failure remains a failed cleanup", (t) => {
		const f = cleanup(t, [["firefox", "installed"]], {
			CLEANUP_FAIL_ACTION: action,
		});
		assert.equal(f.result.status, 37, f.result.stderr);
		assert.equal(f.commands.at(-1).split(" ")[0], action);
		assert.equal(
			f.commands.length,
			["remove", "autoremove", "clean"].indexOf(action) + 1,
		);
	});
}
