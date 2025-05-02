import type { NodeSSH } from "node-ssh";
import { DeployerBase } from "./deployer-base.mjs";
import { execSync } from "node:child_process";

export class APIDeployer extends DeployerBase {
	constructor(ssh: NodeSSH) {
		super("API", "bible-on-site-api", ssh);
	}

	async deploy(): Promise<void> {
		await this.failIfLocalVersionNotNewer();
	}

	async getLocalVersion(): Promise<string> {
		const command = `cargo make version | grep -v "INFO"`;
		const options = { cwd: "../../web/api" };
		try {
			return execSync(command, options).toString().trim();
		} catch (error: unknown) {
			console.error(`Error calculating local ${this.moduleName} version`);
			throw error; // Re-throw the error to propagate it
		}
	}
}
