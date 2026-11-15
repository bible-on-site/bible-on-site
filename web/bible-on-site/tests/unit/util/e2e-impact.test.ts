import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "@jest/globals";

import E2eImpactReporter, {
	dumpImpactCoverage,
} from "../../../../shared/tests-util/e2e-impact";

const coverage = {
	"/site/src/reader.ts": {
		path: "/site/src/reader.ts",
		statementMap: {
			"0": { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
		},
		fnMap: {},
		branchMap: {},
		s: { "0": 1 },
		f: {},
		b: {},
	},
};

function withEvidence(run: (dir: string) => void): void {
	const parent = resolve(tmpdir());
	const dir = mkdtempSync(join(parent, "e2e-impact-identity-"));
	const previous = process.env.E2E_IMPACT_DIR;
	try {
		process.env.E2E_IMPACT_DIR = dir;
		run(dir);
	} finally {
		if (previous === undefined) delete process.env.E2E_IMPACT_DIR;
		else process.env.E2E_IMPACT_DIR = previous;
		assert.equal(dirname(resolve(dir)), parent);
		rmSync(dir, { recursive: true, force: true });
	}
}

function readJson(file: string) {
	return JSON.parse(readFileSync(file, "utf8"));
}

describe("Playwright reporter and fixture coverage identity", () => {
	test("joins real TestInfo-shaped dumps to discovery and results", () => {
		withEvidence((dir) => {
			const file = "e2e\\commentary.test.ts";
			const titles = ["Reader navigation", "מדרש תנחומא", "opens its passage"];
			const reportedTest = {
				titlePath: () => ["", "Desktop", file, ...titles],
				outcome: () => "expected",
			};
			const reporter = new E2eImpactReporter();
			reporter.onBegin(
				{ rootDir: "/site/tests" },
				{ allTests: () => [reportedTest] },
			);
			for (const realm of ["browser", "server"] as const) {
				dumpImpactCoverage(
					{
						titlePath: [file, ...titles],
						project: { name: "Desktop" },
						workerIndex: 0,
						retry: 0,
					},
					realm,
					coverage,
				);
			}
			reporter.onTestEnd(reportedTest, { retry: 0, status: "passed" });
			reporter.onEnd();
			const discovered = readJson(join(dir, "discovered.json")).tests[0];
			assert.deepEqual(discovered, {
				id: ["e2e/commentary.test.ts", ...titles].join(" :: "),
				project: "Desktop",
				file: "e2e/commentary.test.ts",
				titlePath: titles,
			});
			assert.equal(
				readJson(join(dir, "test-results.json")).tests[0].id,
				discovered.id,
			);
			const files = readdirSync(join(dir, "coverage"));
			assert.equal(files.length, 2);
			const realms = new Set<string>();
			for (const name of files) {
				const event = readJson(join(dir, "coverage", name));
				for (const key of ["id", "project", "file", "titlePath"] as const) {
					assert.deepEqual(event[key], discovered[key]);
				}
				assert.deepEqual(event.coverage, coverage);
				realms.add(event.realm);
			}
			assert.deepEqual(realms, new Set(["browser", "server"]));
		});
	});

	test("preserves one identity across projects, workers and retries without overwrites", () => {
		withEvidence((dir) => {
			const attempts = [
				{ project: "Desktop", workerIndex: 0, retry: 0 },
				{ project: "Mobile", workerIndex: 0, retry: 0 },
				{ project: "Desktop", workerIndex: 1, retry: 0 },
				{ project: "Desktop", workerIndex: 2, retry: 1 },
			];
			for (const attempt of attempts) {
				dumpImpactCoverage(
					{
						titlePath: ["e2e/search.test.ts", "opens a result"],
						...attempt,
						project: { name: attempt.project },
					},
					"browser",
					coverage,
				);
			}
			const files = readdirSync(join(dir, "coverage"));
			assert.equal(files.length, attempts.length);
			const events = files.map((name) => readJson(join(dir, "coverage", name)));
			assert.deepEqual(
				[...new Set(events.map((event) => event.id))],
				["e2e/search.test.ts :: opens a result"],
			);
			assert.deepEqual(
				[...new Set(events.map((event) => event.project))].sort(),
				["Desktop", "Mobile"],
			);
		});
	});

	test("keeps disabled and empty coverage runs free of evidence files", () => {
		withEvidence((dir) => {
			const info = {
				titlePath: ["e2e/search.test.ts", "opens a result"],
				project: { name: "Desktop" },
				workerIndex: 0,
				retry: 0,
			};
			dumpImpactCoverage(info, "browser", {});
			delete process.env.E2E_IMPACT_DIR;
			dumpImpactCoverage(info, "browser", coverage);
			const reporter = new E2eImpactReporter();
			reporter.onBegin({ rootDir: "/site/tests" }, { allTests: () => [] });
			reporter.onEnd();
			assert.equal(readdirSync(dir).length, 0);
		});
	});
});
