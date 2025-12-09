import yargs from "yargs";
import { APIDeployer } from "./api-deployer.mjs";
import { WebsiteDeployer } from "./website-deployer.mjs";
import { establishSSHConnections } from "./ssh/index.mjs";
import type { DeployerBase } from "./deployer-base.mjs";

const deployers = {
	website: WebsiteDeployer,
	api: APIDeployer,
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
		.help()
		.alias("help", "h")
		.parse();

	const moduleName = argv.moduleName;
	const moduleVersion = argv.moduleVersion;

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
	console.info(`Starting deployment for module: ${moduleName}...`);
	console.info("Establishing SSH connections...");
	const connections = await establishSSHConnections();
	const dirtyDeployers: Array<DeployerBase> = [];
	// TODO: parallelize deployment across connections
	for (const connection of connections) {
		console.info(`Deploying on ${connection.config.name}...`);
		const DeployerClass = deployers[moduleName];
		const deployer = new DeployerClass(connection);
		dirtyDeployers.push(deployer);
		deployer.setLocalVersion(moduleVersion);
		try {
			await deployer.deploy();
		} catch (error) {
			console.error(
				`Deployment failed on connection ${connection.config.name}:`,
				error,
			);
			console.info("Rolling back deployment attempts for all connections...");
			for (const deployer of dirtyDeployers) {
				deployer.rollback();
			}
			for (const connectionToDrop of connections) {
				connectionToDrop.drop();
			}
			process.exit(1);
		}
	}
	console.info(
		"All deployments completed successfully. Cleaning up previous deployments for each connection...",
	);
	for (const deployer of dirtyDeployers) {
		await deployer.finalizeDeployment();
		deployer.dispose();
	}
	console.info("Deployment process finished successfully.");
}
