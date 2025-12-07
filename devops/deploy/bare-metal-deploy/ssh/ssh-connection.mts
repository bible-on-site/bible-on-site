import { NodeSSH } from "node-ssh";
import type { SSHConfig } from "./ssh-config.mjs";

export class SSHConnection {
	constructor(
		public readonly config: SSHConfig,
		public client?: NodeSSH,
	) {}
	async connect(): Promise<void> {
		if (!this.config && !this.client) {
			return Promise.reject(new Error("neither config nor client are set"));
		}
		this.client ??= new NodeSSH();
		await this.client.connect({
			host: this.config.ip,
			username: this.config.user,
			privateKey: this.config.privateKey,
			passphrase: this.config.passphrase,
			port: 22,
		});
	}
	drop() {
		if (this.client?.isConnected()) {
			this.client.dispose();
			console.info("SSH connection closed.");
		}
	}
}
