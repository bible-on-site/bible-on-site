import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
	CODACY_COVERAGE_LANGUAGES,
	findCodacyReporter,
	publishCodacyCoverage,
} from "./codacy-coverage.mjs";

function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "codacy coverage "));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const reporter = join(directory, "verified download");
	const version = join(reporter, "14.1.3");
	mkdirSync(version, { recursive: true });
	const binary = join(version, "codacy-coverage-reporter");
	const report = join(directory, "combined report ; $HOME 'quoted'.info");
	writeFileSync(binary, "fixture executable\n", { mode: 0o755 });
	writeFileSync(report, "SF:example.ts\nDA:1,1\nend_of_record\n");
	return { directory, reporter, binary, report };
}

test("uploads all five languages through one downloaded binary before one final notification", (t) => {
	const { reporter, binary, report } = fixture(t);
	const env = {
		CODACY_PROJECT_TOKEN: "private-test-token",
		GITHUB_SHA: "a".repeat(40),
		GITHUB_EVENT_PATH: "/runner/pull-request.json",
	};
	const original = { ...env };
	const calls = [];
	publishCodacyCoverage(reporter, report, {
		env,
		run: (command, args, options) => calls.push({ command, args, options }),
	});
	assert.deepEqual(CODACY_COVERAGE_LANGUAGES, [
		"TypeScript",
		"Javascript",
		"Python",
		"CSharp",
		"Rust",
	]);
	assert.deepEqual(
		calls.map(({ command, args }) => [command, ...args]),
		[
			...CODACY_COVERAGE_LANGUAGES.map((language) => [
				resolve(binary),
				"report",
				"--partial",
				"-l",
				language,
				"-r",
				resolve(report),
			]),
			[resolve(binary), "final"],
		],
	);
	for (const { args, options } of calls) {
		assert.strictEqual(options.env, env);
		assert.equal(options.stdio, "inherit");
		assert.ok(!args.includes(env.CODACY_PROJECT_TOKEN));
	}
	assert.deepEqual(
		env,
		original,
		"preserves provider SHA detection and credentials",
	);
});

for (const failedLanguage of CODACY_COVERAGE_LANGUAGES) {
	test(`stops before finalization and remaining uploads when ${failedLanguage} fails`, (t) => {
		const { reporter, report } = fixture(t);
		const calls = [];
		const failure = new Error("upload rejected");
		assert.throws(
			() =>
				publishCodacyCoverage(reporter, report, {
					env: { CODACY_PROJECT_TOKEN: "private-test-token" },
					run: (_command, args) => {
						calls.push(args);
						if (args[3] === failedLanguage) throw failure;
					},
				}),
			(error) => error === failure,
		);
		assert.deepEqual(
			calls.map((args) => args[3]),
			CODACY_COVERAGE_LANGUAGES.slice(
				0,
				CODACY_COVERAGE_LANGUAGES.indexOf(failedLanguage) + 1,
			),
		);
		assert.ok(calls.every((args) => args[0] === "report"));
	});
}

test("propagates final notification failure without repeating uploads or finalization", (t) => {
	const { reporter, report } = fixture(t);
	const calls = [];
	const failure = new Error("final rejected");
	assert.throws(
		() =>
			publishCodacyCoverage(reporter, report, {
				env: { CODACY_PROJECT_TOKEN: "private-test-token" },
				run: (_command, args) => {
					calls.push(args);
					if (args[0] === "final") throw failure;
				},
			}),
		(error) => error === failure,
	);
	assert.equal(calls.length, 6);
	assert.equal(calls.filter((args) => args[0] === "final").length, 1);
});

test("rejects missing credentials and invalid inputs before publishing any partial report", (t) => {
	const { directory, reporter, report } = fixture(t);
	let calls = 0;
	const run = () => calls++;
	for (const token of [undefined, "", " \t"]) {
		assert.throws(
			() =>
				publishCodacyCoverage(reporter, report, {
					env: { CODACY_PROJECT_TOKEN: token },
					run,
				}),
			/CODACY_PROJECT_TOKEN is required/,
		);
	}
	for (const [script, coverage] of [
		[join(directory, "missing"), report],
		[reporter, join(directory, "missing")],
		[report, report],
		[reporter, directory],
	]) {
		assert.throws(() =>
			publishCodacyCoverage(script, coverage, {
				env: { CODACY_PROJECT_TOKEN: "private-test-token" },
				run,
			}),
		);
	}
	assert.equal(calls, 0);
});

test("selects exactly one native executable and rejects missing or ambiguous downloads", (t) => {
	const { reporter, binary } = fixture(t);
	assert.equal(findCodacyReporter(reporter), resolve(binary));
	renameSync(binary, `${binary}-assembly.jar`);
	assert.throws(
		() => findCodacyReporter(reporter),
		/Expected one downloaded native/,
	);
	renameSync(`${binary}-assembly.jar`, binary);
	const another = join(reporter, "another-version");
	mkdirSync(another);
	writeFileSync(join(another, "codacy-coverage-reporter"), "another\n", {
		mode: 0o755,
	});
	assert.throws(
		() => findCodacyReporter(reporter),
		/Expected one downloaded native/,
	);
});

test("rejects a downloaded file without executable permission", {
	skip: process.platform === "win32",
}, (t) => {
	const { reporter, binary } = fixture(t);
	chmodSync(binary, 0o644);
	assert.throws(() => findCodacyReporter(reporter), /EACCES/);
});

test("executes the CLI with literal spaced paths and stops before final on child failure", {
	skip: process.platform === "win32",
}, (t) => {
	const { directory, reporter, binary, report } = fixture(t);
	const log = join(directory, "calls.jsonl");
	writeFileSync(
		binary,
		[
			"#!/usr/bin/env node",
			'const fs = require("node:fs");',
			"const args = process.argv.slice(2);",
			"fs.appendFileSync(process.env.CODACY_TEST_LOG, JSON.stringify({args, sha:process.env.GITHUB_SHA, event:process.env.GITHUB_EVENT_PATH}) + '\\n');",
			'if (args[0] === "report" && args[3] === process.env.CODACY_TEST_FAIL_LANGUAGE) process.exit(9);',
		].join("\n"),
	);
	const env = {
		...process.env,
		CODACY_PROJECT_TOKEN: "private-test-token",
		CODACY_TEST_LOG: log,
		GITHUB_SHA: "a".repeat(40),
		GITHUB_EVENT_PATH: join(directory, "event with spaces.json"),
	};
	const cli = fileURLToPath(new URL("./codacy-coverage.mjs", import.meta.url));
	const success = spawnSync(process.execPath, [cli, reporter, report], {
		env,
		encoding: "utf8",
	});
	assert.equal(success.status, 0, success.stderr);
	const records = readFileSync(log, "utf8")
		.trim()
		.split(/\r?\n/)
		.map((line) => JSON.parse(line));
	assert.deepEqual(
		records.map((row) => row.args),
		[
			...CODACY_COVERAGE_LANGUAGES.map((language) => [
				"report",
				"--partial",
				"-l",
				language,
				"-r",
				report,
			]),
			["final"],
		],
	);
	for (const row of records) {
		assert.equal(row.sha, env.GITHUB_SHA);
		assert.equal(row.event, env.GITHUB_EVENT_PATH);
		assert.ok(!row.args.includes(env.CODACY_PROJECT_TOKEN));
	}
	writeFileSync(log, "");
	const failure = spawnSync(process.execPath, [cli, reporter, report], {
		env: { ...env, CODACY_TEST_FAIL_LANGUAGE: "CSharp" },
		encoding: "utf8",
	});
	assert.notEqual(failure.status, 0);
	assert.deepEqual(
		readFileSync(log, "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line).args[3]),
		["TypeScript", "Javascript", "Python", "CSharp"],
	);
	assert.ok(
		!`${failure.stdout}${failure.stderr}`.includes(env.CODACY_PROJECT_TOKEN),
	);
});

test("downloads the verified reporter once before publishing the merged report in the actual workflow", () => {
	const workflow = parse(
		readFileSync(
			new URL("../../../.github/workflows/ci.yml", import.meta.url),
			"utf8",
		),
	);
	const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
	const upload = steps.filter(
		(step) => step.name === "Publish Cross Module Coverage To Codacy",
	);
	assert.equal(upload.length, 1);
	assert.deepEqual(upload[0].env, {
		CODACY_PROJECT_TOKEN: `\${{ secrets.CODACY_PROJECT_TOKEN }}`,
	});
	assert.equal(upload[0].uses, undefined);
	assert.match(
		upload[0].run,
		/mktemp -d "\$RUNNER_TEMP\/codacy-coverage\.XXXXXX"/,
	);
	assert.match(upload[0].run, /curl --fail --silent --show-error --location/);
	assert.equal(
		(upload[0].run.match(/https:\/\/coverage\.codacy\.com\/get\.sh/g) ?? [])
			.length,
		1,
	);
	assert.match(
		upload[0].run,
		/CODACY_REPORTER_TMP_FOLDER="\$REPORTER_DIRECTORY\/cli"/,
	);
	assert.match(upload[0].run, /CODACY_REPORTER_SKIP_CHECKSUM=false/);
	assert.equal(
		(
			upload[0].run.match(/bash "\$REPORTER_DIRECTORY\/get\.sh" download/g) ??
			[]
		).length,
		1,
	);
	assert.match(
		upload[0].run,
		/node devops\/github\/ci\/codacy-coverage\.mjs "\$REPORTER_DIRECTORY\/cli" "\$CROSS_MODULE_COVERAGE_REPORT"/,
	);
	assert.ok(
		!/CODACY_COMMIT_UUID|GITHUB_SHA=|--commit-uuid|--final|--partial/.test(
			upload[0].run,
		),
	);
	const merge = steps.findIndex(
		(step) => step.name === "Merge Test Coverage (Website + API)",
	);
	const publish = steps.indexOf(upload[0]);
	const verify = steps.findIndex(
		(step) => step.name === "Verify Coverage 3rd Party Reporting",
	);
	assert.ok(merge >= 0 && merge < publish && publish < verify);
	assert.ok(
		upload[0].run.indexOf('get.sh" download') <
			upload[0].run.indexOf("node devops/"),
	);
	const scripts = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	).scripts;
	assert.ok(
		scripts["test:workflow-timeouts"].includes(
			"github/ci/codacy-coverage.test.mjs",
		),
	);
});

test("measures the uploader in hosted coverage and requires its LCOV record", () => {
	const coverage = readFileSync(
		new URL("./release-coverage.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(
		coverage.includes(
			'"--test-coverage-include=devops/github/ci/codacy-coverage.mjs"',
		),
	);
	assert.ok(coverage.includes('"devops/github/ci/codacy-coverage.test.mjs"'));
	assert.ok(coverage.includes('"devops/github/ci/codacy-coverage.mjs"'));
});
