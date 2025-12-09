import { execSync } from "node:child_process";
import path from "node:path";
import { pMemoizeDecorator as memoize } from "p-memoize";
import { DeployerBase } from "./deployer-base.mjs";
import type { SSHConnection } from "./ssh/ssh-connection.mjs";

export class APIDeployer extends DeployerBase {
	constructor(connection: SSHConnection) {
		super("api", "bible-on-site-api", connection);
	}

	@memoize()
	async getLocalVersion(): Promise<string> {
		const localVersion = this.wrappedLocalVersion;
		if (localVersion) {
			return localVersion;
		}
		const command = `cargo make version | grep -v "INFO"`;
		const options = { cwd: "../../../web/api" };
		try {
			return execSync(command, options).toString().trim();
		} catch (error: unknown) {
			console.error(`Error calculating local ${this.moduleName} version`);
			throw error; // Re-throw the error to propagate it
		}
	}
	@memoize()
	override async getDockerImageTarGzPath(): Promise<string> {
		return path.resolve(
			__dirname,
			`../../../web/api/.release/bible-on-site-api.tar-v${await this.getLocalVersion()}.gz`,
		);
	}
}
