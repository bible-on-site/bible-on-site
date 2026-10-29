import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const devopsDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(devopsDirectory, "..");
const websiteDirectory = "web/bible-on-site";
const fixtures = join(devopsDirectory, "fixtures/coverage-gaps");

function fixtureReport(name, root, newline = "\n") {
	return readFileSync(join(fixtures, name), "utf8")
		.split("FIXTURE_ROOT")
		.join(root)
		.split("\r\n")
		.join("\n")
		.split("\n")
		.join(newline);
}

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), "coverage-gaps-"));
	try {
		mkdirSync(join(root, "devops"), { recursive: true });
		mkdirSync(join(root, websiteDirectory, "scripts"), { recursive: true });
		copyFileSync(
			join(devopsDirectory, "coverage-gaps.mjs"),
			join(root, "devops/coverage-gaps.mjs"),
		);
		copyFileSync(
			join(repoRoot, websiteDirectory, "scripts/coverage-gaps.mjs"),
			join(root, websiteDirectory, "scripts/coverage-gaps.mjs"),
		);
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function report(root, relative, contents) {
	const destination = join(root, relative);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, contents);
}

function execute(root, cli, args = []) {
	const website = cli === "website";
	const result = spawnSync(
		process.execPath,
		[
			join(
				root,
				website
					? `${websiteDirectory}/scripts/coverage-gaps.mjs`
					: "devops/coverage-gaps.mjs",
			),
			...args,
		],
		{
			cwd: website ? join(root, websiteDirectory) : root,
			encoding: "utf8",
		},
	);
	assert.ifError(result.error);
	return result;
}

for (const cli of ["devops", "website"]) {
	const moduleRoot = cli === "website" ? websiteDirectory : "data";
	const location = `${moduleRoot}/.coverage/unit/lcov.info`;

	for (const newline of ["\n", "\r\n"]) {
		const ending = newline === "\n" ? "LF" : "CRLF";
		test(
			cli +
				" ignores covered BRDA records and embedded record text (" +
				ending +
				")",
			() =>
				fixture((root) => {
					report(
						root,
						location,
						fixtureReport("covered.info", moduleRoot, newline),
					);
					const result = execute(root, cli);
					assert.equal(result.status, 0, result.stderr);
					assert.equal(result.stdout, "No uncovered lines.\n");
				}),
		);

		test(
			cli +
				" reports exact zero lines, checksums and unexecuted branches (" +
				ending +
				")",
			() =>
				fixture((root) => {
					report(
						root,
						location,
						fixtureReport("gaps.info", moduleRoot, newline),
					);
					const result = execute(root, cli);
					assert.equal(result.status, 0, result.stderr);
					assert.match(result.stdout, /^src\/gaps\.ts {2}lines 2\/4\n/);
					assert.match(result.stdout, /^ {2}missed lines: {4}10, 20$/m);
					assert.match(result.stdout, /^ {2}missed branches: 30, 40$/m);
					if (cli === "devops") {
						assert.match(result.stdout, /overall lines 2\/4 \(50\.0%\)/);
					}
				}),
		);
	}

	test(
		cli +
			" preserves filters, deduplication, numeric order and Windows source paths",
		() =>
			fixture((root) => {
				const windowsRoot = `C:\\fixture\\${moduleRoot.split("/").join("\\")}`;
				report(
					root,
					location,
					fixtureReport("covered.info", windowsRoot) +
						fixtureReport("gaps.info", windowsRoot),
				);
				const selected = execute(root, cli, ["gaps.ts"]);
				assert.equal(selected.status, 0, selected.stderr);
				assert.match(selected.stdout, /^src\/gaps\.ts {2}lines 2\/4\n/);
				assert.doesNotMatch(selected.stdout, /covered\.ts/);
				const missing = execute(root, cli, ["absent"]);
				assert.equal(missing.status, 0, missing.stderr);
				assert.equal(
					missing.stdout,
					"No uncovered lines in files matching: absent\n",
				);
			}),
	);

	test(`${cli} fails when its known report is absent`, () =>
		fixture((root) => {
			const result = execute(root, cli);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /not found/);
			assert.equal(result.stdout, "");
		}));
}

test("devops preserves module selection, bare separator and filtered aggregate counts", () =>
	fixture((root) => {
		report(
			root,
			"web/admin/.coverage/merged/lcov.info",
			fixtureReport("covered.info", "web/admin") +
				fixtureReport("gaps.info", "web/admin"),
		);
		const result = execute(root, "devops", ["--", "--module", "admin"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /overall lines 4\/6 \(66\.7%\)/);
		const filtered = execute(root, "devops", ["--module", "admin", "gaps.ts"]);
		assert.equal(filtered.status, 0, filtered.stderr);
		assert.match(filtered.stdout, /overall lines 2\/4 \(50\.0%\)/);
	}));

test("devops website selection uses the existing unit report", () =>
	fixture((root) => {
		report(
			root,
			`${websiteDirectory}/.coverage/unit/lcov.info`,
			fixtureReport("gaps.info", websiteDirectory),
		);
		const result = execute(root, "devops", ["--module", "website"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^src\/gaps\.ts {2}lines 2\/4/);
	}));

test("devops rejects unknown modules without consulting arbitrary paths", () =>
	fixture((root) => {
		const result = execute(root, "devops", ["--module", "../elsewhere"]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Unknown module/);
		assert.equal(result.stdout, "");
	}));
