import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ECRClient } from "@aws-sdk/client-ecr";
import packageJson from "../../../web/bible-on-site/package.json" with {
	type: "json",
};
import type { ECRConfig } from "./ecr-client.mjs";
import { ECRDeployerBase } from "./ecr-deployer-base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WebsiteECRDeployer extends ECRDeployerBase {
	constructor(client: ECRClient, config: ECRConfig) {
		super("website", "bible-on-site", "bible-on-site", client, config);
	}

	async getLocalVersion(): Promise<string> {
		if (this.wrappedLocalVersion) {
			return this.wrappedLocalVersion;
		}
		return packageJson.version;
	}

	async getDockerImageTag(): Promise<string> {
		const version = await this.getLocalVersion();
		return `${this.dockerImageName}:v${version}`;
	}

	protected override getBuildCwd(): string {
		// Build context is web/ to include both bible-on-site and shared directories
		return path.resolve(__dirname, "../../../web");
	}

	protected override get dockerBuildContext(): string {
		return ".";
	}

	protected override get dockerfilePath(): string {
		return "bible-on-site/Dockerfile";
	}
}
