import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
);
const start = workflow.indexOf(
	"          # Match the native website package job.",
);
const end = workflow.indexOf(
	"          # The artifacts job is only triggered",
	start,
);
assert.ok(start !== -1 && end > start);
const script = workflow.slice(start, end);
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function check(overrides = {}, env = {}) {
	const values = {
		"github.event_name": "pull_request",
		"github.repository": "test/repo",
		"github.event.pull_request.head.repo.full_name": "test/repo",
		"needs.setup_env.outputs.is_master_branch": "false",
		"needs.package_website.result": "success",
		"needs.package_website.outputs.module_version": "0.2.600",
		...overrides,
	};
	const compiled = script.replace(/\$\{\{ ([^}]+) \}\}/g, (_, key) => {
		assert.ok(Object.hasOwn(values, key), key);
		return values[key];
	});
	return spawnSync(shell, ["--noprofile", "--norc", "-e", "-c", compiled], {
		encoding: "utf8",
		env: {
			...process.env,
			WEBSITE_MODULE_CHANGED: "true",
			WEBSITE_CI_CHANGED: "false",
			...env,
		},
	});
}

// Website/admin ship a single native ARM64 release image (#3794); the one
// package job carries the whole release contract.
for (const state of ["failure", "cancelled", "skipped"]) {
	test(`package_website ${state} blocks selected website release images`, () => {
		const result = check({ "needs.package_website.result": state });
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /must pass/);
	});
}
test("trusted PR, merge queue and master images require a nonempty version", () => {
	for (const trigger of [
		{},
		{ "github.event_name": "merge_group" },
		{
			"github.event_name": "push",
			"needs.setup_env.outputs.is_master_branch": "true",
		},
	]) {
		assert.equal(check(trigger).status, 0);
		assert.equal(
			check({
				...trigger,
				"needs.package_website.outputs.module_version": "",
			}).status,
			1,
		);
	}
});
test("a trusted workflow-only website change still gates the package job", () => {
	assert.equal(
		check(
			{ "needs.package_website.result": "skipped" },
			{ WEBSITE_MODULE_CHANGED: "false", WEBSITE_CI_CHANGED: "true" },
		).status,
		1,
	);
});
test("forks, unselected changes and nonmaster pushes do not require production SSG secrets", () => {
	const skipped = {
		"needs.package_website.result": "skipped",
	};
	assert.equal(
		check({
			...skipped,
			"github.event.pull_request.head.repo.full_name": "fork/repo",
		}).status,
		0,
	);
	assert.equal(check(skipped, { WEBSITE_MODULE_CHANGED: "false" }).status, 0);
	assert.equal(check({ ...skipped, "github.event_name": "push" }).status, 0);
	assert.equal(
		check(
			{
				...skipped,
				"github.event_name": "push",
				"needs.setup_env.outputs.is_master_branch": "true",
			},
			{ WEBSITE_MODULE_CHANGED: "false", WEBSITE_CI_CHANGED: "true" },
		).status,
		0,
	);
});

const cd = readFileSync(
	new URL("../../../.github/workflows/cd-aws.yml", import.meta.url),
	"utf8",
);
const deployment = cd
	.split("      - name: Deploy to ECR\n")[1]
	.split("      - name: Save API handover evidence")[0];
const publish = deployment
	.split("        run: |\n")[1]
	.split("        # API publication")[0];

// The API still ships amd64+arm64; website/admin releases are ARM64-only
// (#3794) so the canonical amd64 flag follows published provenance.
for (const [moduleName, nativeAmd64] of [
	["website", "false"],
	["api", "true"],
	["admin", "false"],
]) {
	for (const index of ["true", "false"]) {
		test(`CD passes exact source and absolute native archives for ${moduleName}, index ${index}`, () => {
			const workspace = "/tmp/release workspace";
			const archive = "web/candidate/native-arm64.tar.gz";
			const values = {
				"env.MODULE_NAME": moduleName,
				"env.MODULE_VERSION": "0.2.600",
				"github.workspace": workspace,
				"steps.prepare_docker_restore.outputs.DOCKER_IMAGE_TAR_GZ_PATH":
					"web/candidate/native.tar.gz",
			};
			const compiled = publish.replace(/\$\{\{ ([^}]+) \}\}/g, (_, key) => {
				assert.ok(Object.hasOwn(values, key), key);
				return values[key];
			});
			const result = spawnSync(
				shell,
				[
					"--noprofile",
					"--norc",
					"-e",
					"-c",
					`bun() { printf '%s\\0' "$@"; }\n${compiled}`,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						MODULE_NAME: moduleName,
						GITHUB_WORKSPACE: workspace,
						RELEASE_AMD64_ARCHIVE: "web/candidate/native.tar.gz",
						RELEASE_ARM64_ARCHIVE: archive,
						RELEASE_SOURCE: "a".repeat(40),
						API_HAS_ARM64: "true",
						WEBSITE_HAS_ARM64: "true",
						ADMIN_HAS_ARM64: "true",
						NATIVE_AMD64: nativeAmd64,
						API_PUBLISH_INDEX: index,
						WEBSITE_PUBLISH_INDEX: index,
						ADMIN_PUBLISH_INDEX: index,
					},
				},
			);
			assert.equal(result.status, 0, result.stderr);
			const args = result.stdout.split("\0").filter(Boolean);
			const amd64 = args.indexOf("--docker-image");
			if (nativeAmd64 === "true") {
				assert.equal(
					args[amd64 + 1],
					`${workspace}/web/candidate/native.tar.gz`,
				);
			} else {
				assert.equal(amd64, -1);
			}
			assert.equal(
				args[args.indexOf("--docker-image-arm64") + 1],
				`${workspace}/${archive}`,
			);
			assert.equal(args[args.indexOf("--source-ref") + 1], "a".repeat(40));
			assert.equal(args.includes("--publish-index"), index === "true");
		});
	}
}

// Historical paired website/admin releases still redeploy the amd64 archive.
for (const moduleName of ["website", "admin"]) {
	test(`CD redeploys a paired ${moduleName} release with its amd64 archive`, () => {
		const workspace = "/tmp/release workspace";
		const archive = "web/candidate/native-arm64.tar.gz";
		const values = {
			"env.MODULE_NAME": moduleName,
			"env.MODULE_VERSION": "0.2.600",
			"github.workspace": workspace,
			"steps.prepare_docker_restore.outputs.DOCKER_IMAGE_TAR_GZ_PATH":
				"web/candidate/native.tar.gz",
		};
		const compiled = publish.replace(/\$\{\{ ([^}]+) \}\}/g, (_, key) => {
			assert.ok(Object.hasOwn(values, key), key);
			return values[key];
		});
		const result = spawnSync(
			shell,
			[
				"--noprofile",
				"--norc",
				"-e",
				"-c",
				`bun() { printf '%s\\0' "$@"; }\n${compiled}`,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					MODULE_NAME: moduleName,
					GITHUB_WORKSPACE: workspace,
					RELEASE_AMD64_ARCHIVE: "web/candidate/native.tar.gz",
					RELEASE_ARM64_ARCHIVE: archive,
					RELEASE_SOURCE: "a".repeat(40),
					API_HAS_ARM64: "true",
					WEBSITE_HAS_ARM64: "true",
					ADMIN_HAS_ARM64: "true",
					NATIVE_AMD64: "true",
					API_PUBLISH_INDEX: "false",
					WEBSITE_PUBLISH_INDEX: "false",
					ADMIN_PUBLISH_INDEX: "false",
				},
			},
		);
		assert.equal(result.status, 0, result.stderr);
		const args = result.stdout.split("\0").filter(Boolean);
		assert.equal(
			args[args.indexOf("--docker-image") + 1],
			`${workspace}/web/candidate/native.tar.gz`,
		);
		assert.equal(
			args[args.indexOf("--docker-image-arm64") + 1],
			`${workspace}/${archive}`,
		);
	});
}
