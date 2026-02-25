import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ECRClient } from "@aws-sdk/client-ecr";
import packageJson from "../../../web/admin/package.json" with {
	type: "json",
};
import type { ECRConfig } from "./ecr-client.mjs";
import { ECRDeployerBase } from "./ecr-deployer-base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AdminECRDeployer extends ECRDeployerBase {
	constructor(client: ECRClient, config: ECRConfig) {
		super(
			"admin",
			"bible-on-site-admin",
			"bible-on-site-admin",
			client,
			config,
		);
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

	override async getDockerImageArchivePath(): Promise<string> {
		const version = await this.getLocalVersion();
		return path.resolve(
			__dirname,
			`../../../web/admin/.release/bible-on-site-admin-v${version}.tar.gz`,
		);
	}

	protected override getBuildCwd(): string {
		return path.resolve(__dirname, "../../../web");
	}

	protected override get dockerBuildContext(): string {
		return ".";
	}

	protected override get dockerfilePath(): string {
		return "admin/Dockerfile";
	}
}
