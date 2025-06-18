import * as dotenv from "dotenv";
import { NodeSSH } from "node-ssh";

export async function establishSSHConnections(): Promise<Array<NodeSSH>> {
	dotenv.config({
		path: "./deploy/.env", // It's a workaround as I didn't manage to make cwd to be set to deploy folder preliminary to execution
	});
	const sshConfigs = getSSHConfigs();
	const sshConnections: Array<NodeSSH> = [];
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
			console.info("SSH connection established.");
			sshConnections.push(ssh);
		} catch (error) {
			dropConnection(ssh);
			// If any connection, no deploy should be made in order to avoid partial deployment
			throw new Error(
				`Failed to connect or execute command for ${connectionName}: ${error}`,
			);
		}
	}
	return sshConnections;
}

export function dropConnection(ssh: NodeSSH) {
	if (ssh.isConnected()) {
		ssh.dispose();
		console.info("SSH connection closed.");
	}
}

function getSSHConfigs(): Record<string, SSHConfig> {
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
interface SSHConfig {
	ip: string;
	user: string;
	passphrase: string;
	privateKey: string;
}
