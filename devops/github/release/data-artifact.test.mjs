import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveSqlArtifact } from "./data-artifact.mjs";

const ref = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const input = { repo: "test/repo", runId: "10", ref };
const artifact = {
	id: 90,
	name: "perushim-data-sql",
	expired: false,
	digest,
	workflow_run: { id: 10, head_sha: ref },
};

test("SQL prefers fresh generated data and binds one archive across pages", () => {
	const result = resolveSqlArtifact(input, (url) => ({
		artifacts: url.endsWith("page=1")
			? Array(100).fill({
					...artifact,
					id: 100,
					name: "perushim-data-sql.master",
				})
			: [
					{ ...artifact, id: 89 },
					artifact,
					{ ...artifact, id: 101, expired: true },
				],
	}));
	assert.deepEqual(result, {
		artifactId: "90",
		artifactDigest: digest,
		sourceRunId: "10",
		sourceRef: ref,
	});
});

test("a pinned archive never falls back to another artifact on API failure", () => {
	assert.throws(
		() =>
			resolveSqlArtifact({ ...input, artifactId: "90" }, (url) => {
				assert.match(url, /\/artifacts\/90$/);
				throw new Error("Artifact deleted");
			}),
		/Artifact deleted/,
	);
});

test("wrong archive identity, source, digest and expired SQL fail closed", () => {
	for (const [bad, message] of [
		[{ ...artifact, id: 91 }, /does not match pinned archive 90/],
		[{ ...artifact, expired: true }, /archive is expired/],
		[{ ...artifact, name: "unrelated" }, /Untrusted SQL artifact name/],
		[{ ...artifact, digest: undefined }, /no verified sha256 digest/],
		[
			{ ...artifact, workflow_run: { id: 11, head_sha: ref } },
			/produced by run 11 .* not by run 10/,
		],
		[
			{ ...artifact, workflow_run: { id: 10, head_sha: "c".repeat(40) } },
			/produced by run 10 at c+, not by run 10 at a+/,
		],
		[
			{ ...artifact, digest: `sha256:${"c".repeat(64)}` },
			/digest does not match the pinned digest/,
		],
	])
		assert.throws(
			() =>
				resolveSqlArtifact(
					{ ...input, artifactId: "90", artifactDigest: digest },
					() => bad,
				),
			message,
		);
	assert.throws(
		() => resolveSqlArtifact(input, () => ({ artifacts: [] })),
		/No SQL artifact was produced by this CI run/,
	);
});

const producingRef = "d".repeat(40);
const baseline = {
	id: 80,
	name: "perushim-data-sql.master",
	expired: false,
	digest,
	workflow_run: {
		id: 7,
		head_sha: producingRef,
		head_branch: "master",
		repository_id: 1,
		head_repository_id: 1,
	},
};
const producingRun = {
	name: "Continuous Integration",
	event: "push",
	head_branch: "master",
	head_sha: producingRef,
};
const inputSha = "e".repeat(40);
const baselineRequest = (overrides = {}) =>
	(url) => {
		if (url.includes("/artifacts?name="))
			return { artifacts: overrides.artifacts ?? [baseline] };
		if (url.endsWith("/actions/runs/7"))
			return overrides.producingRun ?? producingRun;
		if (url.includes("/contents/"))
			return (
				overrides.contents?.(url) ?? [
					{ name: "perushim-view", sha: inputSha },
					{
						name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
						sha: inputSha,
					},
				]
			);
		throw new Error(`Unexpected API call: ${url}`);
	};

test("a skipped producer binds the trusted master SQL baseline by ID and digest", () => {
	const result = resolveSqlArtifact(
		{ ...input, baseline: true },
		baselineRequest(),
	);
	assert.deepEqual(result, {
		artifactId: "80",
		artifactDigest: digest,
		sourceRunId: "7",
		sourceRef: producingRef,
	});
});

test("a baseline pinned by its dispatch is re-verified against the declared source", () => {
	const result = resolveSqlArtifact(
		{
			...input,
			artifactId: "80",
			artifactDigest: digest,
			sourceRunId: "7",
			sourceRef: producingRef,
		},
		(url) => {
			if (url.endsWith("/artifacts/80")) return baseline;
			if (url.endsWith("/actions/runs/7")) return producingRun;
			if (url.includes("/contents/"))
				return [
					{ name: "perushim-view", sha: inputSha },
					{
						name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
						sha: inputSha,
					},
				];
			throw new Error(`Unexpected API call: ${url}`);
		},
	);
	assert.deepEqual(result, {
		artifactId: "80",
		artifactDigest: digest,
		sourceRunId: "7",
		sourceRef: producingRef,
	});
});

test("a baseline whose declared source disagrees with the archive fails closed", () => {
	assert.throws(
		() =>
			resolveSqlArtifact(
				{ ...input, artifactId: "80", sourceRunId: "8", sourceRef: producingRef },
				(url) => (url.endsWith("/artifacts/80") ? baseline : producingRun),
			),
		/not by run 8/,
	);
});

test("baselines from fork, PR or non-CI runs are never trusted", () => {
	for (const [candidate, message] of [
		[
			{ ...baseline, workflow_run: { ...baseline.workflow_run, head_repository_id: 2 } },
			/fork/,
		],
	]) {
		assert.throws(
			() =>
				resolveSqlArtifact(
					{ ...input, baseline: true },
					baselineRequest({ artifacts: [candidate] }),
				),
			message,
		);
	}
	for (const run of [
		{ ...producingRun, event: "pull_request" },
		{ ...producingRun, head_branch: "feature" },
		{ ...producingRun, name: "Nightly" },
	]) {
		assert.throws(
			() =>
				resolveSqlArtifact(
					{ ...input, baseline: true },
					baselineRequest({ producingRun: run }),
				),
			/untrusted run 7/,
		);
	}
});

test("a baseline with changed SQL inputs is rejected for the delivered revision", () => {
	assert.throws(
		() =>
			resolveSqlArtifact(
				{ ...input, baseline: true },
				baselineRequest({
					contents: (url) =>
						url.includes(`ref=${producingRef}`)
							? [
									{ name: "perushim-view", sha: "f".repeat(40) },
									{
										name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
										sha: inputSha,
									},
								]
							: [
									{ name: "perushim-view", sha: inputSha },
									{
										name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
										sha: inputSha,
									},
								],
				}),
			),
		/input data\/sefaria\/pipelines\/perushim-view differs between/,
	);
});

test("missing or expired baselines report why no archive can be bound", () => {
	assert.throws(
		() =>
			resolveSqlArtifact(
				{ ...input, baseline: true },
				baselineRequest({ artifacts: [] }),
			),
		/No trusted master SQL baseline is available/,
	);
	assert.throws(
		() =>
			resolveSqlArtifact(
				{ ...input, baseline: true },
				baselineRequest({ artifacts: [{ ...baseline, expired: true }] }),
			),
		/No trusted master SQL baseline is available for this run \(#80: SQL artifact archive is expired\)/,
	);
});

test("the newest incompatible baseline does not shadow an older compatible one", () => {
	const staleRef = "9".repeat(40);
	const incompatible = {
		...baseline,
		id: 81,
		workflow_run: { ...baseline.workflow_run, id: 8, head_sha: staleRef },
	};
	const staleRun = { ...producingRun, head_sha: staleRef };
	const result = resolveSqlArtifact(
		{ ...input, baseline: true },
		(url) => {
			if (url.includes("/artifacts?name="))
				return { artifacts: [incompatible, baseline] };
			if (url.endsWith("/actions/runs/8")) return staleRun;
			if (url.endsWith("/actions/runs/7")) return producingRun;
			if (url.includes("/contents/"))
				return url.includes(`ref=${staleRef}`)
					? [
							{ name: "perushim-view", sha: "f".repeat(40) },
							{
								name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
								sha: inputSha,
							},
						]
					: [
							{ name: "perushim-view", sha: inputSha },
							{
								name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
								sha: inputSha,
							},
						];
			throw new Error(`Unexpected API call: ${url}`);
		},
	);
	assert.equal(result.artifactId, "80");
});

test("release_data binds the baseline source only when the producer is skipped", () => {
	const ci = readFileSync(
		new URL("../../../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	).replace(/\r/g, "");
	assert.match(
		ci,
		/^      data_deploy_changed: \$\{\{ steps\.determine\.outputs\.data_deploy_changed \}\}$/m,
	);
	const release = ci.split("  release_data:\n")[1].split("\n  bump_versions:")[0];
	const condition = release.match(/^    if: (.+)$/m)?.[1];
	assert.ok(condition, "Data release requires a job-level condition");
	// Delivery intent = payload inputs only. Shared CI plumbing
	// (data_ci_changed) can never enter this job: the producer skips such runs
	// and no current-run SQL exists to bind (#2730).
	assert.ok(condition.includes("data_module_changed == 'true'"));
	assert.ok(condition.includes("data_deploy_changed == 'true'"));
	assert.ok(condition.includes("perushim_pipeline_module_changed == 'true'"));
	assert.ok(condition.includes("data_schema_only_changed == 'false'"));
	assert.ok(!condition.includes("data_ci_changed"));
	// The whole job must skip — not succeed as a no-op — so a run without
	// delivery intent cannot supersede queued data deployments.
	assert.ok(condition.includes("perushim_data.result == 'skipped'"));
	const bind = release.split("- name: Bind SQL artifact source")[1].split("\n      - name:")[0];
	assert.match(
		bind,
		/SQL_FROM_BASELINE: \$\{\{ needs\.perushim_data\.result == 'skipped' \}\}/,
	);
});

for (const release of [false, true])
	for (const valid of [true, false]) {
		test(`the production SQL download verifies the archive before extraction (release=${release}, valid=${valid})`, (t) => {
			const root = mkdtempSync(join(tmpdir(), "sql-delivery-"));
			t.after(() => rmSync(root, { recursive: true, force: true }));
			const fixture = join(root, "fixture.zip");
			execFileSync("python", [
				"-c",
				"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('perushim_data.sql','SELECT 1;'); z.close()",
				fixture,
			]);
			const workflow = readFileSync(
				new URL(
					`../../../.github/workflows/${release ? "shared-release" : "cd-data"}.yml`,
					import.meta.url,
				),
				"utf8",
			).replace(/\r/g, "");
			const script = workflow
				.split(
					`      - name: ${release ? "Download Artifacts" : "Download Perushim SQL"}\n`,
				)[1]
				.split("        run: |\n")[1]
				.split("\n      - name:")[0]
				.split("\n")
				.map((line) => line.slice(10))
				.join("\n")
				.replace(
					/\$\{\{ inputs.artifacts_json \}\}/g,
					JSON.stringify([{ name: "perushim-data-sql", path: "data/mysql" }]),
				)
				.replace(
					/\$\{\{ steps.check_tag.outputs.CD_PAYLOAD \|\| steps.build_payload.outputs.CD_PAYLOAD \}\}/g,
					JSON.stringify({ ci_run_id: "10", ci_run_attempt: "1" }),
				)
				.replace(/\$\{\{ github.repository \}\}/g, "test/repo")
				.replace(/\$\{\{ github.sha \}\}/g, ref);
			const hash = createHash("sha256")
				.update(readFileSync(fixture))
				.digest("hex");
			const shell =
				process.platform === "win32"
					? "C:/Program Files/Git/bin/bash.exe"
					: "bash";
			const result = spawnSync(
				shell,
				[
					"-c",
					`gh() { if [[ "$2" == */zip ]]; then cat "$ZIP_FIXTURE"; elif [[ "$2" == */artifacts ]]; then echo "$ARTIFACT_META"; else echo 1; fi; }\n${script}`,
				],
				{
					cwd: root,
					encoding: "utf8",
					env: {
						...process.env,
						ARTIFACT_META: JSON.stringify({
							...artifact,
							digest: `sha256:${valid ? hash : "0".repeat(64)}`,
						}),
						ZIP_FIXTURE: fixture.replace(/\\/g, "/"),
						RUNNER_TEMP: root.replace(/\\/g, "/"),
						REPO: "test/repo",
						ARTIFACT_ID: "90",
						ARTIFACT_DIGEST: `sha256:${valid ? hash : "0".repeat(64)}`,
					},
				},
			);
			assert.equal(result.status, valid ? 0 : 1, result.stderr);
			if (valid)
				assert.equal(
					readFileSync(join(root, "data/mysql/perushim_data.sql"), "utf8"),
					"SELECT 1;",
				);
		});
	}
