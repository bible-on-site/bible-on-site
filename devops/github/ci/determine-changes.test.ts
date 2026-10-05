import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import {
	baseRevision,
	detectChanges,
	MODULES,
	type ModuleKey,
	main,
} from "./determine-changes.ts";

const changed = (files: string[], ...keys: ModuleKey[]) =>
	keys.map((key) => detectChanges(files)[key]);

describe("detectChanges", () => {
	test("mobile matrix workflow changes require app checks without a release", () => {
		const changes = detectChanges([".github/workflows/app-mobile-e2e.yml"]);
		assert.deepEqual(changes.app, { module_changed: false, ci_changed: true });
		assert.equal(changes.website.ci_changed, false);
	});

	for (const path of [
		"web/bible-on-site/package.json",
		"web/bible-on-site/package-lock.json",
		"web/bible-on-site/src/lib/recitation-audio.ts",
	]) {
		test(`${path} checks the decoder without releasing the app`, () => {
			assert.deepEqual(changed([path], "app"), [
				{ module_changed: false, ci_changed: true },
			]);
		});
	}

	test("approved timings release the website without releasing the app", () => {
		assert.deepEqual(
			changed(["data/recitation/recitation.sqlite"], "website", "app", "data"),
			[
				{ module_changed: true, ci_changed: false },
				{ module_changed: false, ci_changed: false },
				{ module_changed: true, ci_changed: false },
			],
		);
	});

	test("a packaged decoder change releases the app", () => {
		assert.deepEqual(
			changed(["app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js"], "app"),
			[{ module_changed: true, ci_changed: false }],
		);
	});

	test("native audio bridge changes release both dependent modules", () => {
		const path = "app/BibleOnSite/Resources/Raw/recitation-audio.html";
		assert.deepEqual(changed([path], "app", "website"), [
			{ module_changed: true, ci_changed: false },
			{ module_changed: true, ci_changed: false },
		]);
	});

	test("unrelated website UI does not run app checks", () => {
		assert.deepEqual(changed(["web/bible-on-site/src/app/page.tsx"], "app"), [
			{ module_changed: false, ci_changed: false },
		]);
	});

	test("CI workflow and detection changes validate every module without releasing it", () => {
		for (const path of SHARED_FILES) {
			for (const flags of Object.values(detectChanges([path]))) {
				assert.deepEqual(flags, { module_changed: false, ci_changed: true });
			}
		}
	});

	test("release workflow changes validate only released modules", () => {
		const changes = detectChanges([".github/workflows/shared-release.yml"]);
		for (const key of ["website", "api", "app", "bulletin"] as const) {
			assert.equal(changes[key].ci_changed, true, key);
		}
		for (const key of ["admin", "data", "perushim_pipeline"] as const) {
			assert.equal(changes[key].ci_changed, false, key);
		}
	});

	test("directory CI paths match nested files only", () => {
		assert.equal(
			detectChanges(["devops/rustfs/policy.json"]).admin.ci_changed,
			true,
		);
		assert.equal(
			detectChanges(["devops/deploy/data-deploy/index.mts"]).data.ci_changed,
			true,
		);
		assert.equal(
			detectChanges(["devops/deploy/data-deploy-old.mts"]).data.ci_changed,
			false,
		);
	});

	test("module directories match path segments, not prefixes", () => {
		const changes = detectChanges(["web/api-docs/readme.md", "appendix.md"]);
		assert.equal(changes.api.module_changed, false);
		assert.equal(changes.app.module_changed, false);
	});

	test("the perushim pipeline is also part of the data module", () => {
		const changes = detectChanges([
			"data/sefaria/pipelines/perushim-view/src/main.rs",
		]);
		assert.equal(changes.perushim_pipeline.module_changed, true);
		assert.equal(changes.data.module_changed, true);
	});
});

const SHARED_FILES = [
	".github/workflows/ci.yml",
	"devops/github/ci/determine-changes.ts",
];

describe("baseRevision", () => {
	test("uses the tested PR merge parent even when the event base is stale", () => {
		assert.deepEqual(
			baseRevision("pull_request", { pull_request: { base: { sha: "a1" } } }),
			{ kind: "merge-parent" },
		);
	});

	test("uses the commit before a push", () => {
		assert.deepEqual(baseRevision("push", { before: "b2" }), {
			kind: "sha",
			sha: "b2",
		});
	});

	test("uses HEAD's parent when the pushed ref was created", () => {
		assert.deepEqual(baseRevision("push", { before: "0".repeat(40) }), {
			kind: "parent",
		});
	});

	test("uses the merge-queue base", () => {
		assert.deepEqual(
			baseRevision("merge_group", { merge_group: { base_sha: "c3" } }),
			{ kind: "sha", sha: "c3" },
		);
	});

	test("uses master for manual runs", () => {
		assert.deepEqual(baseRevision("workflow_dispatch", {}), {
			kind: "branch",
			branch: "master",
		});
	});

	test("rejects a payload without its base", () => {
		assert.throws(
			() => baseRevision("merge_group", {}),
			/merge_group.base_sha/,
		);
	});
});

describe("main", () => {
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

	function commit(cwd: string, path: string) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), `${path}\n`);
		git(cwd, "add", ".");
		git(cwd, "commit", "--quiet", "-m", path);
		return git(cwd, "rev-parse", "HEAD");
	}

	/**
	 * Builds origin history `base -> (api change) -> (website change)` on master,
	 * then runs `main` in a depth-1 clone of HEAD, like actions/checkout. PRs
	 * use a synthetic merge whose first parent has newer release-only bumps.
	 */
	function run(
		eventName: string,
		event: (shas: { root: string; replaced: string; base: string }) => object,
	) {
		const directory = mkdtempSync(join(tmpdir(), "determine-changes-"));
		try {
			const work = join(directory, "work");
			const origin = join(directory, "origin.git");
			const clone = join(directory, "clone");
			mkdirSync(work);
			git(work, "init", "--quiet", "--initial-branch=master");
			git(work, "config", "user.name", "CI fixture");
			git(work, "config", "user.email", "ci-fixture@example.invalid");
			git(work, "config", "core.autocrlf", "false");
			const root = commit(work, "README.md");
			git(work, "checkout", "--quiet", "-b", "replaced");
			const replaced = commit(work, "web/admin/src/main.tsx");
			git(work, "checkout", "--quiet", "master");
			const base = commit(work, "web/api/src/main.rs");
			if (eventName === "pull_request") {
				git(work, "checkout", "--quiet", "-b", "feature");
				commit(work, "web/bible-on-site/src/page.tsx");
				git(work, "checkout", "--quiet", "master");
				commit(work, "web/admin/package.json");
				commit(work, "web/bulletin/Cargo.toml");
				git(
					work,
					"merge",
					"--no-ff",
					"--quiet",
					"feature",
					"-m",
					"Tested PR merge",
				);
			} else {
				commit(work, "web/bible-on-site/src/page.tsx");
			}
			git(directory, "clone", "--quiet", "--bare", work, origin);
			// A force push leaves the replaced commit unreachable from any ref.
			git(origin, "branch", "--quiet", "-D", "replaced");
			// GitHub serves fetches of commits by SHA.
			git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
			git(
				directory,
				"clone",
				"--quiet",
				"--depth=1",
				`file://${origin.replace(/\\/g, "/")}`,
				clone,
			);
			const eventPath = join(directory, "event.json");
			const outputPath = join(directory, "output.txt");
			writeFileSync(eventPath, JSON.stringify(event({ root, replaced, base })));
			const changes = main(
				{
					GITHUB_EVENT_NAME: eventName,
					GITHUB_EVENT_PATH: eventPath,
					GITHUB_OUTPUT: outputPath,
				},
				clone,
			);
			const output = readFileSync(outputPath, "utf8");
			assert.equal(
				output.trim().split("\n").length,
				Object.keys(MODULES).length * 2,
			);
			return { changes, output };
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}

	const websiteOnly = (changes: ReturnType<typeof detectChanges>) =>
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website"],
		);
	const apiAndWebsite = (changes: ReturnType<typeof detectChanges>) =>
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website", "api"],
		);

	test("pull_request excludes newer master-only version bumps in a shallow tested merge", () => {
		const { changes, output } = run("pull_request", ({ base }) => ({
			pull_request: { base: { sha: base } },
		}));
		websiteOnly(changes);
		assert.match(output, /^website_module_changed=true$/m);
		assert.match(output, /^api_module_changed=false$/m);
		assert.match(output, /^website_ci_changed=false$/m);
		assert.match(output, /^admin_module_changed=false$/m);
		assert.match(output, /^bulletin_module_changed=false$/m);
	});

	test("push compares with the commit before the push", () => {
		apiAndWebsite(run("push", ({ root }) => ({ before: root })).changes);
	});

	test("a force push compares with the replaced commit", () => {
		const { changes } = run("push", ({ replaced }) => ({ before: replaced }));
		assert.deepEqual(
			Object.entries(changes)
				.filter(([, flags]) => flags.module_changed)
				.map(([key]) => key),
			["website", "api", "admin"],
		);
	});

	test("push of a new ref compares with HEAD's parent", () => {
		websiteOnly(run("push", () => ({ before: "0".repeat(40) })).changes);
	});

	test("merge_group compares with the queue base", () => {
		websiteOnly(
			run("merge_group", ({ base }) => ({ merge_group: { base_sha: base } }))
				.changes,
		);
	});

	test("workflow_dispatch compares with master", () => {
		const { changes } = run("workflow_dispatch", () => ({}));
		for (const flags of Object.values(changes)) {
			assert.deepEqual(flags, { module_changed: false, ci_changed: false });
		}
	});
});
