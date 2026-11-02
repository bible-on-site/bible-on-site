import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
mkdirSync(new URL("../../../.coverage/devops/", import.meta.url), {
	recursive: true,
});
const result = spawnSync(
	process.execPath,
	[
		"--experimental-test-coverage",
		"--test-coverage-include=devops/deploy/ecr-deploy/**",
		"--test-coverage-include=devops/asset-mirror.mjs",
		"--test-coverage-include=devops/assets-cdn.mjs",
		"--test-coverage-include=devops/assets-cdn-check.mjs",
		"--test-coverage-include=devops/github/release/**",
		"--test-coverage-include=devops/github/ci/verify-native-image.mjs",
		"--test-coverage-include=devops/github/ci/verify-api-native.mjs",
		"--test-coverage-include=devops/github/ci/native-api-fixture.mjs",
		"--test-coverage-include=web/api/tests/coverage-file.mjs",
		"--test-coverage-exclude=**/*.test.*",
		"--test-reporter=spec",
		"--test-reporter-destination=stdout",
		"--test-reporter=lcov",
		"--test-reporter-destination=.coverage/devops/lcov.info",
		"--test",
		"devops/asset-mirror.test.mjs",
		"devops/assets-cdn.test.mjs",
		"devops/assets-cdn-check.test.mjs",
		"devops/deploy/ecr-deploy/resume-image.test.mts",
		"devops/deploy/ecr-deploy/ecr-client.test.mts",
		"devops/deploy/ecr-deploy/api-images.test.mts",
		"devops/deploy/ecr-deploy/api-public-transport.test.mjs",
		"devops/deploy/ecr-deploy/api-public-monitor.test.mjs",
		"devops/deploy/ecr-deploy/api-task-protection.test.mjs",
		"devops/deploy/ecr-deploy/api-rollout-state.test.mjs",
		"devops/deploy/ecr-deploy/api-rollout-aws.test.mjs",
		"devops/deploy/ecr-deploy/api-rollout.test.mjs",
		"devops/deploy/ecr-deploy/api-rollout-cli.test.mjs",
		"devops/github/release/api-image-assets.test.mjs",
		"devops/github/release/website-handover-lock.test.mjs",
		"devops/github/release/check-deployment.test.mjs",
		"devops/github/ci/verify-native-image.test.mjs",
		"devops/github/ci/verify-api-native.test.mjs",
		"devops/github/ci/native-api-fixture.test.mjs",
		"web/api/tests/coverage-file.test.mjs",
	],
	{ cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
	const records = readFileSync(
		new URL("../../../.coverage/devops/lcov.info", import.meta.url),
		"utf8",
	)
		.replace(/\\/g, "/")
		.split(/\r?\n/);
	for (const file of [
		"devops/asset-mirror.mjs",
		"devops/assets-cdn.mjs",
		"devops/assets-cdn-check.mjs",
		"devops/deploy/ecr-deploy/api-images.mts",
		"devops/deploy/ecr-deploy/website-images.mts",
		"devops/deploy/ecr-deploy/api-public-transport.mjs",
		"devops/deploy/ecr-deploy/api-public-monitor.mjs",
		"devops/deploy/ecr-deploy/api-task-protection.mjs",
		"devops/deploy/ecr-deploy/api-rollout-state.mjs",
		"devops/deploy/ecr-deploy/api-rollout-aws.mjs",
		"devops/deploy/ecr-deploy/api-rollout.mjs",
		"devops/deploy/ecr-deploy/api-rollout-cli.mjs",
		"devops/github/release/api-image-assets.mjs",
		"devops/github/release/website-handover-lock.mjs",
		"devops/github/ci/verify-native-image.mjs",
		"devops/github/ci/verify-api-native.mjs",
		"devops/github/ci/native-api-fixture.mjs",
		"web/api/tests/coverage-file.mjs",
	]) {
		if (!records.includes(`SF:${file}`))
			throw new Error(`Release regression coverage is missing ${file}`);
	}
}
