import * as dotenv from "dotenv";
import { SSHConnection } from "./ssh-connection.mjs";
import type { SSHConfig } from "./ssh-config.mjs";

export async function establishSSHConnections(): Promise<Array<SSHConnection>> {
	dotenv.config({
		path: "./deploy/.env", // It's a workaround as I didn't manage to make cwd to be set to deploy folder preliminary to execution
	});
	const connections: Array<SSHConnection> = getSSHConfigs().map((config) => {
		return new SSHConnection(config);
	});
	for (const connection of connections) {
		try {
			await connection.connect();
			console.info("SSH connection established.");
		} catch (error) {
			connection.drop();
			// If any connection, no deploy should be made in order to avoid partial deployment
			throw new Error(
				`Failed to connect or execute command for ${connection.config.name}: ${error}`,
			);
		}
	}
	return connections;
}

function getSSHConfigs(): Array<SSHConfig> {
	return Object.entries(process.env).reduce(
		(acc, [key, value]) => {
			// Updated regex to handle optional _SSH before the suffix
			const match = RegExp(
				/^(.+?)(?:_SSH)?_(SSH_KEY|USER|IP|PASSPHRASE)$/,
			).exec(key);
			if (!match || !value) return acc;
			// Adjusted indices for prefix and type
			const [_, name, type] = match;
			let config = acc.find((c) => c.name === name);
			if (!config) {
				config = {
					name: name,
					ip: "",
					user: "",
					passphrase: "",
					privateKey: "",
				};
				acc.push(config);
			}
			switch (type) {
				case "SSH_KEY":
					config.privateKey = value;
					break;
				case "USER":
					config.user = value;
					break;
				case "IP":
					config.ip = value;
					break;
				case "PASSPHRASE":
					config.passphrase = value;
					break;
			}
			return acc;
		},
		[] as Array<SSHConfig>,
	);
}
