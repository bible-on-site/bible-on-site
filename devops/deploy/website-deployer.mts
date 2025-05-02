import type { NodeSSH } from "node-ssh";
import { DeployerBase } from "./deployer-base.mjs";
import * as packageJson from "../../web/bible-on-site/package.json" assert {
	type: "json",
};
export class WebsiteDeployer extends DeployerBase {
	constructor(ssh: NodeSSH) {
		super("Website", "bible-on-site", ssh);
	}

	async deploy(): Promise<void> {
		await this.failIfLocalVersionNotNewer();
	}

	async getLocalVersion(): Promise<string> {
		return packageJson.version;
	}
}
