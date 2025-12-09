import * as dotenv from "dotenv";
import yargs from "yargs";
import { APIECRDeployer } from "./api-deployer.mjs";
import { createECRClient, getECRConfig } from "./ecr-client.mjs";
import type { ECRDeployerBase } from "./ecr-deployer-base.mjs";
import { WebsiteECRDeployer } from "./website-deployer.mjs";

// Load environment variables
dotenv.config({
	path: "./deploy/ecr-deploy/.env",
});

const deployers = {
	website: WebsiteECRDeployer,
	api: APIECRDeployer,
};

await main();

async function main() {
	const { hideBin } = await import("yargs/helpers");

	const argv = await yargs(hideBin(process.argv))
		.option("module-name", {
			alias: "m",
			describe: "The module to deploy",
			choices: ["website", "api"] as const,
			demandOption: true,
			type: "string",
		})
		.option("module-version", {
			alias: "v",
			describe: "The version of the module to deploy",
			demandOption: false,
			type: "string",
		})
		.option("docker-image", {
			alias: "i",
			describe:
				"Path to a Docker image archive (.tar or .tar.gz) to push directly",
			demandOption: false,
			type: "string",
		})
		.help()
		.alias("help", "h")
		.parse();

	const moduleName = argv.moduleName;
	const moduleVersion = argv.moduleVersion;
	const dockerImagePath = argv.dockerImage;

	if (!moduleName) {
		console.error("Module name is required.");
		process.exit(1);
	}

	if (!deployers[moduleName]) {
		console.error(
			`Invalid module name: ${moduleName}. Available modules: ${Object.keys(
				deployers,
			).join(", ")}`,
		);
		process.exit(1);
	}

	console.info(`Starting ECR deployment for module: ${moduleName}...`);

	try {
		// Get AWS configuration (async - validates SSO credentials)
		const config = await getECRConfig();
		console.info(`Using AWS region: ${config.region}`);
		console.info(`Using AWS account: ${config.accountId}`);

		// Create ECR client
		const client = createECRClient(config);

		// Create deployer
		const DeployerClass = deployers[moduleName];
		const deployer: ECRDeployerBase = new DeployerClass(client, config);
		deployer.setLocalVersion(moduleVersion);
		deployer.setDockerImagePath(dockerImagePath);

		// Deploy
		await deployer.deploy();

		console.info("ECR deployment process finished successfully.");
	} catch (error) {
		console.error("ECR deployment failed:", error);
		process.exit(1);
	}
}
