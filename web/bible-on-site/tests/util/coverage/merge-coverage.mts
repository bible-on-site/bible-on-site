import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

mkdirSync(`${process.env.npm_config_local_prefix}/.coverage/merged`, {
	recursive: true,
});
mergeCoverage();

function mergeCoverage(): void {
	console.log("Merging coverage reports...");
	console.log(
		`unit: ${process.env.npm_config_local_prefix}/.coverage/unit/lcov.info`,
	);
	console.log(
		readFileSync(
			`${process.env.npm_config_local_prefix}/.coverage/unit/lcov.info`,
			"utf-8",
		),
	);
	console.log(
		`e2e: ${process.env.npm_config_local_prefix}/.coverage/e2e/lcov.info`,
	);
	console.log(
		readFileSync(
			`${process.env.npm_config_local_prefix}/.coverage/e2e/lcov.info`,
			"utf-8",
		),
	);
	const cmd = `docker run --rm -t -v ${process.env.npm_config_local_prefix}/.coverage:/.coverage lcov-cli:0.0.2 --rc branch_coverage=1 -a /.coverage/unit/lcov.info -a /.coverage/e2e/lcov.info -o /.coverage/merged/lcov.info`;

	try {
		const output = execSync(cmd);
		console.log(output.toString());
	} catch (error) {
		console.error("Error merging coverage:", error);
		process.exit(1);
	}
}
