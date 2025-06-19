import { DeployerBase } from "./deployer-base.mjs";
import * as packageJson from "../../web/bible-on-site/package.json" assert {
	type: "json",
};
import { pMemoizeDecorator } from "p-memoize";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SSHConnection } from "./ssh/ssh-connection.mjs";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
export class WebsiteDeployer extends DeployerBase {
	constructor(connection: SSHConnection) {
		super("website", "bible-on-site", connection);
	}

	@pMemoizeDecorator()
	async getLocalVersion(): Promise<string> {
		const localVersion = this.wrappedLocalVersion;
		if (localVersion) {
			return localVersion;
		}
		return packageJson.version;
	}
	@pMemoizeDecorator()
	override async getDockerImageTarGzPath(): Promise<string> {
		return path.resolve(
			__dirname,
			`../../web/bible-on-site/.release/bible-on-site-v${await this.getLocalVersion()}.tar.gz`,
		);
	}
	override get dockerRunOptions(): string {
		return "-p 3000:3000";
	}
}
