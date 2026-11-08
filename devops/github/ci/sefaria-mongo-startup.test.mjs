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
import { fileURLToPath } from "node:url";

const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const script = fileURLToPath(
	new URL("../../../data/sefaria/mongodb-docker/restore.sh", import.meta.url),
);
const unix = (value) =>
	process.platform === "win32"
		? `/${value[0].toLowerCase()}${value.slice(2).replace(/\\/g, "/")}`
		: value;

function restore(t, changes = {}) {
	const dir = mkdtempSync(join(tmpdir(), "sefaria-restore-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const trace = join(dir, "trace");
	const stopped = join(dir, "stopped");
	const pid = join(dir, "pid");
	const ready = join(dir, "ready");
	const commands = {
		chown: 'printf "chown %s\\n" "$*" >> "$MONGO_TRACE"',
		sync: 'printf "sync\\n" >> "$MONGO_TRACE"',
		gosu: 'printf "gosu %s\\n" "$1" >> "$MONGO_TRACE"; shift; exec "$@"',
		mongod:
			'printf "%s" "$$" > "$MONGO_PID"; trap \'touch "$MONGO_STOPPED"; exit 0\' TERM; if [ "$MONGO_EXIT_EARLY" = 1 ]; then exit 17; fi; touch "$MONGO_READY"; while :; do /usr/bin/sleep 0.05; done',
		// A live PID can precede an early exit; it is not a successful ping.
		mongosh:
			'if [ ! -f "$MONGO_READY" ] || ! kill -0 "$(cat "$MONGO_PID")" 2>/dev/null; then exit 1; fi; case "$*" in *countDocuments*) printf "%s\\n" "$MONGO_COUNT";; *) printf "{ok:1}\\n";; esac',
		mongorestore:
			'printf "restore %s\\n" "$*" >> "$MONGO_TRACE"; exit "$MONGO_RESTORE_EXIT"',
		sleep: ":", // The child uses the real absolute sleep; only readiness polling is accelerated.
	};
	for (const [name, body] of Object.entries(commands)) {
		writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	}
	const result = spawnSync(
		shell,
		[
			"--noprofile",
			"--norc",
			"-c",
			'export PATH="$MONGO_BIN:$PATH"; exec sh "$MONGO_SCRIPT" "$MONGO_DBPATH" "$MONGO_DUMP"',
		],
		{
			encoding: "utf8",
			timeout: 5000,
			env: {
				...process.env,
				MONGO_BIN: unix(dir),
				MONGO_SCRIPT: unix(script),
				MONGO_DBPATH: `${unix(dir)}/db`,
				MONGO_DUMP: `${unix(dir)}/dump`,
				MONGO_TRACE: unix(trace),
				MONGO_STOPPED: unix(stopped),
				MONGO_PID: unix(pid),
				MONGO_READY: unix(ready),
				MONGO_COUNT: "3",
				MONGO_RESTORE_EXIT: "0",
				MONGO_EXIT_EARLY: "0",
				...changes,
			},
		},
	);
	assert.ifError(result.error);
	return {
		result,
		trace: existsSync(trace) ? readFileSync(trace, "utf8") : "",
		stopped: existsSync(stopped),
	};
}

test("a successful build restores as mongodb and waits for the exact server to stop", (t) => {
	const f = restore(t);
	assert.equal(f.result.status, 0, f.result.stderr);
	assert.match(f.trace, /gosu mongodb/);
	assert.match(f.trace, /restore --drop /);
	assert.match(f.result.stdout, /Restored 3 Sefaria documents/);
	assert.ok(f.stopped);
	assert.match(f.trace, /sync/);
});

test("a failed restore remains a failed build after server cleanup", (t) => {
	const f = restore(t, { MONGO_RESTORE_EXIT: "23" });
	assert.equal(f.result.status, 23, f.result.stderr);
	assert.ok(f.stopped);
	assert.doesNotMatch(f.result.stdout, /Restored/);
	assert.doesNotMatch(f.trace, /sync/);
});

for (const count of ["0", "not-a-count", ""]) {
	test(`an invalid restored corpus ${JSON.stringify(count)} cannot be committed`, (t) => {
		const f = restore(t, { MONGO_COUNT: count });
		assert.notEqual(f.result.status, 0);
		assert.ok(f.stopped);
		assert.doesNotMatch(f.trace, /sync/);
	});
}

test("a server that dies before readiness never runs a restore", (t) => {
	const f = restore(t, { MONGO_EXIT_EARLY: "1" });
	assert.notEqual(f.result.status, 0);
	assert.doesNotMatch(f.trace, /restore --drop/);
});
