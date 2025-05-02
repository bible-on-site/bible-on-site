import * as dotenv from "dotenv";
import { NodeSSH } from "node-ssh";
import yargs from "yargs";
import { APIDeployer } from "./api-deployer.mjs";
import { WebsiteDeployer } from "./website-deployer.mjs";
interface SSHConfig {
	ip: string;
	user: string;
	passphrase: string;
	privateKey: string;
}

const deployers = {
	website: WebsiteDeployer,
	api: APIDeployer,
};

await main();

async function main() {
	const { hideBin } = await import("yargs/helpers");

	const argv = await yargs
		.default(hideBin(process.argv))
		.scriptName("deploy")
		.usage("Usage: $0 <moduleName>")
		.positional("moduleName", {
			describe: "The name of the module to deploy",
			type: "string",
			choices: Object.keys(deployers),
		})
		.demandCommand(1, "You must provide a module name to deploy.")
		.help()
		.alias("h", "help")
		.parse();

	const moduleName = argv.moduleName as keyof typeof deployers;

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
	dotenv.config();
	const sshConfigs = getSSHConnections();
	for (const [connectionName, config] of Object.entries(sshConfigs)) {
		const ssh = new NodeSSH();
		try {
			await ssh.connect({
				host: config.ip,
				username: config.user,
				privateKey: config.privateKey,
				passphrase: config.passphrase,
				port: 22,
			});
			console.log("SSH connection established.");
			const deployer = new deployers[moduleName](ssh);
			await deployer.deploy();
		} catch (error) {
			console.error(
				`Failed to connect or execute command for ${connectionName}:`,
				error,
			);
		} finally {
			if (ssh.isConnected()) {
				ssh.dispose();
				console.log("SSH connection closed.");
			}
		}
	}
}
function getSSHConnections(): Record<string, SSHConfig> {
	return Object.entries(process.env).reduce(
		(acc, [key, value]) => {
			// Updated regex to handle optional _SSH before the suffix
			const match = RegExp(
				/^(.+?)(?:_SSH)?_(SSH_KEY|USER|IP|PASSPHRASE)$/,
			).exec(key);
			if (!match || !value) return acc;
			// Adjusted indices for prefix and type
			const [_, prefix, type] = match;
			acc[prefix] = acc[prefix] || {
				ip: "",
				user: "",
				passphrase: "",
				privateKey: "",
			};
			switch (type) {
				case "SSH_KEY":
					acc[prefix].privateKey = value;
					break;
				case "USER":
					acc[prefix].user = value;
					break;
				case "IP":
					acc[prefix].ip = value;
					break;
				case "PASSPHRASE":
					acc[prefix].passphrase = value;
					break;
			}
			return acc;
		},
		{} as Record<string, SSHConfig>,
	);
}
