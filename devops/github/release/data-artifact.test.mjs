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
	assert.deepEqual(result, { artifactId: "90", artifactDigest: digest });
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
	for (const bad of [
		{ ...artifact, id: 91 },
		{ ...artifact, expired: true },
		{ ...artifact, name: "unrelated" },
		{ ...artifact, digest: undefined },
		{ ...artifact, workflow_run: { id: 11, head_sha: ref } },
		{ ...artifact, workflow_run: { id: 10, head_sha: "c".repeat(40) } },
		{ ...artifact, digest: `sha256:${"c".repeat(64)}` },
	])
		assert.throws(
			() =>
				resolveSqlArtifact(
					{ ...input, artifactId: "90", artifactDigest: digest },
					() => bad,
				),
			/does not match/,
		);
	assert.throws(
		() => resolveSqlArtifact(input, () => ({ artifacts: [] })),
		/does not match/,
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
