import type { NodeSSH } from "node-ssh";
import { DeployerBase } from "./deployer-base.mjs";
import { execSync } from "node:child_process";
import { pMemoizeDecorator } from "p-memoize";
import path from "node:path";

export class APIDeployer extends DeployerBase {
	constructor(ssh: NodeSSH) {
		super("api", "bible-on-site-api", ssh);
	}

	@pMemoizeDecorator()
	async getLocalVersion(): Promise<string> {
		const localVersion = this.wrappedLocalVersion;
		if (localVersion) {
			return localVersion;
		}
		const command = `cargo make version | grep -v "INFO"`;
		const options = { cwd: "../../web/api" };
		try {
			return execSync(command, options).toString().trim();
		} catch (error: unknown) {
			console.error(`Error calculating local ${this.moduleName} version`);
			throw error; // Re-throw the error to propagate it
		}
	}
	@pMemoizeDecorator()
	override async getDockerImageTarGzPath(): Promise<string> {
		return path.resolve(
			__dirname,
			`../../web/api/.release/bible-on-site-api.tar-v${await this.getLocalVersion()}.gz`,
		);
	}
}
