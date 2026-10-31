import * as dotenv from "dotenv";
import yargs from "yargs";
import { AdminECRDeployer } from "./admin-deployer.mts";
import { APIECRDeployer } from "./api-deployer.mts";
import { createECRClient, getECRConfig } from "./ecr-client.mts";
import type { ECRDeployerBase } from "./ecr-deployer-base.mts";
import { WebsiteECRDeployer } from "./website-deployer.mts";

// Load environment variables
dotenv.config({
	path: "./deploy/ecr-deploy/.env",
});

const deployers = {
	admin: AdminECRDeployer,
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
			choices: ["admin", "website", "api"] as const,
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
		.option("docker-image-arm64", {
			describe: "Path to the native ARM64 API Docker archive",
			type: "string",
		})
		.option("source-ref", {
			describe: "Full source Git SHA carried by both API images",
			type: "string",
		})
		.option("publish-index", {
			describe: "Publish the verified amd64/arm64 API OCI index",
			type: "boolean",
			default: false,
		})
		.check((args) => {
			const indexSpecified = process.argv
				.slice(2)
				.some(
					(argument) =>
						argument === "--publish-index" ||
						argument.startsWith("--publish-index=") ||
						argument === "--no-publish-index",
				);
			const dual =
				args.dockerImageArm64 !== undefined ||
				args.sourceRef !== undefined ||
				args.publishIndex;
			if (args.moduleName !== "api" && (dual || indexSpecified))
				throw new Error("Dual archives and publish-index are API-only");
			if (
				dual &&
				(!args.dockerImage || !args.dockerImageArm64 || !args.sourceRef)
			)
				throw new Error(
					"API dual publication requires docker-image, docker-image-arm64 and source-ref",
				);
			if (
				args.sourceRef !== undefined &&
				(typeof args.sourceRef !== "string" ||
					args.sourceRef.length !== 40 ||
					!/^[a-f0-9]{40}$/.test(args.sourceRef))
			)
				throw new Error(
					"source-ref must be a full lowercase 40-character Git SHA",
				);
			return true;
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

		// Create ECR client
		const client = createECRClient(config);

		// Create deployer
		const DeployerClass = deployers[moduleName];
		const deployer: ECRDeployerBase = new DeployerClass(client, config);
		deployer.setLocalVersion(moduleVersion);
		deployer.setDockerImagePath(dockerImagePath);
		if (argv.dockerImageArm64 || argv.sourceRef || argv.publishIndex) {
			deployer.setAPIImageOptions({
				arm64ArchivePath: argv.dockerImageArm64,
				sourceRef: argv.sourceRef,
				publishIndex: argv.publishIndex,
			});
		}

		// Deploy
		await deployer.deploy();

		console.info("ECR deployment process finished successfully.");
	} catch (error) {
		console.error("ECR deployment failed:", error);
		process.exit(1);
	}
}
