import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	configureRecordings,
	prepareRecitation,
	recordingsKey,
	resolveRecordingsPath,
} from "./local-recitation.mjs";

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "local recitation "));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const appDirectory = path.join(root, "app", "BibleOnSite");
	const recordings = path.join(root, "audio with spaces");
	fs.mkdirSync(appDirectory, { recursive: true });
	fs.mkdirSync(recordings);
	return {
		root,
		appDirectory,
		recordings,
		envFile: path.join(root, "app", ".dev.env.local"),
	};
}

test("default recordings path belongs to the current user's source checkout", (t) => {
	const { root, appDirectory } = fixture(t);
	assert.equal(
		resolveRecordingsPath({ appDirectory, env: {}, userHome: root }),
		path.join(root, "git", "tanah-s3", "recordings"),
	);
});

test("environment overrides saved configuration, including paths with spaces", (t) => {
	const { appDirectory, recordings, envFile, root } = fixture(t);
	fs.writeFileSync(
		envFile,
		`${recordingsKey}=${JSON.stringify(recordings.replace(/\\/g, "/"))}\n`,
	);
	assert.equal(resolveRecordingsPath({ appDirectory, env: {} }), recordings);
	assert.equal(
		resolveRecordingsPath({ appDirectory, env: { [recordingsKey]: root } }),
		root,
	);
});

test("setup prompts with the default and saves the accepted path without changing other settings", async (t) => {
	const { root, appDirectory, envFile } = fixture(t);
	const expected = path.join(root, "git", "tanah-s3", "recordings");
	fs.mkdirSync(expected, { recursive: true });
	fs.writeFileSync(
		envFile,
		"# Local app settings\nAPI_URL=https://example.test\n",
	);
	let question;
	assert.equal(
		await configureRecordings({
			appDirectory,
			env: {},
			userHome: root,
			prompt: async (message) => {
				question = message;
				return "";
			},
		}),
		expected,
	);
	assert.ok(question.includes(expected));
	assert.ok(
		fs.readFileSync(envFile, "utf8").includes("API_URL=https://example.test"),
	);
	assert.equal(resolveRecordingsPath({ appDirectory, env: {} }), expected);
});

test("setup replaces an old value and retains a configurable path with spaces", async (t) => {
	const { appDirectory, envFile, recordings, root } = fixture(t);
	fs.writeFileSync(
		envFile,
		`API_URL=http://localhost:3003\n${recordingsKey}=${JSON.stringify(root.replace(/\\/g, "/"))}\n`,
	);
	await configureRecordings({
		appDirectory,
		env: {},
		prompt: async () => recordings,
	});
	const saved = fs.readFileSync(envFile, "utf8");
	assert.equal(
		saved.split("\n").filter((line) => line.startsWith(recordingsKey)).length,
		1,
	);
	assert.equal(resolveRecordingsPath({ appDirectory, env: {} }), recordings);
});

test("an invalid prompted path does not overwrite working configuration", async (t) => {
	const { root, appDirectory, recordings, envFile } = fixture(t);
	const original = `${recordingsKey}=${JSON.stringify(recordings.replace(/\\/g, "/"))}\n`;
	fs.writeFileSync(envFile, original);
	await assert.rejects(
		configureRecordings({
			appDirectory,
			env: {},
			prompt: async () => path.join(root, "missing"),
		}),
		/Recordings directory does not exist/,
	);
	assert.equal(fs.readFileSync(envFile, "utf8"), original);
});

test("preparation passes the local source as one argument to the existing audited generator", (t) => {
	const { root, appDirectory, recordings } = fixture(t);
	let command;
	prepareRecitation({
		platform: "Android",
		appDirectory,
		recordings,
		env: { PYTHON: "custom python" },
		run: (...args) => {
			command = args;
			return { status: 0 };
		},
	});
	assert.equal(command[0], "custom python");
	assert.deepEqual(command[1], [
		path.join(root, "app", "devops", "prepare_recitation_assets.py"),
		"--local-originals",
		"--platform",
		"Android",
		"--app-directory",
		appDirectory,
		"--recordings",
		recordings,
	]);
	assert.equal(command[2].cwd, root);
	assert.equal(command[2].shell, undefined);
});

test("run preparation reads the path saved by developer setup", async (t) => {
	const { appDirectory, recordings } = fixture(t);
	await configureRecordings({
		appDirectory,
		env: {},
		prompt: async () => recordings,
	});
	let source;
	prepareRecitation({
		platform: "Windows",
		appDirectory,
		env: {},
		run: (_executable, args) => {
			source = args.at(-1);
			return { status: 0 };
		},
	});
	assert.equal(source, recordings);
});

test("missing local audio fails before running a build/download", (t) => {
	const { root, appDirectory } = fixture(t);
	let called = false;
	assert.throws(
		() =>
			prepareRecitation({
				platform: "Android",
				appDirectory,
				recordings: path.join(root, "missing"),
				run: () => {
					called = true;
					return { status: 0 };
				},
			}),
		/configure|RECITATION_RECORDINGS_PATH/,
	);
	assert.equal(called, false);
});

test("relative source paths resolve from the repository regardless of the calling directory", (t) => {
	const { root, appDirectory, recordings } = fixture(t);
	let source;
	prepareRecitation({
		platform: "Android",
		appDirectory,
		recordings: path.relative(root, recordings),
		run: (_executable, args) => {
			source = args.at(-1);
			return { status: 0 };
		},
	});
	assert.equal(source, recordings);
});

test("generator and process-launch failures propagate instead of leaving a seemingly ready app", (t) => {
	const { appDirectory, recordings } = fixture(t);
	assert.throws(
		() =>
			prepareRecitation({
				platform: "iOS",
				appDirectory,
				recordings,
				run: () => ({ status: 3 }),
			}),
		/exit 3/,
	);
	const error = new Error("Python unavailable");
	assert.throws(
		() =>
			prepareRecitation({
				platform: "iOS",
				appDirectory,
				recordings,
				run: () => ({ error, status: null }),
			}),
		(actual) => actual === error,
	);
	assert.throws(
		() =>
			prepareRecitation({
				platform: "unknown",
				appDirectory,
				recordings,
			}),
		/platform/,
	);
});

test("noninteractive configure accepts an explicit environment value without waiting for input", (t) => {
	const { appDirectory, recordings } = fixture(t);
	const script = fileURLToPath(
		new URL("./local-recitation.mjs", import.meta.url),
	);
	const result = spawnSync(
		process.execPath,
		[script, "configure", "--app-directory", appDirectory],
		{
			env: { ...process.env, [recordingsKey]: recordings },
			encoding: "utf8",
			timeout: 10_000,
		},
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(resolveRecordingsPath({ appDirectory, env: {} }), recordings);
});
