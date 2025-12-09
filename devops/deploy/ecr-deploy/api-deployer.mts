import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ECRClient } from "@aws-sdk/client-ecr";
import type { ECRConfig } from "./ecr-client.mjs";
import { ECRDeployerBase } from "./ecr-deployer-base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class APIECRDeployer extends ECRDeployerBase {
	constructor(client: ECRClient, config: ECRConfig) {
		super("api", "bible-on-site-api", "bible-on-site-api", client, config);
	}

	async getLocalVersion(): Promise<string> {
		if (this.wrappedLocalVersion) {
			return this.wrappedLocalVersion;
		}
		const command = `cargo make version | grep -v "INFO"`;
		const cwd = path.resolve(__dirname, "../../../web/api");
		try {
			return execSync(command, { cwd }).toString().trim();
		} catch (error: unknown) {
			console.error(`Error calculating local ${this.moduleName} version`);
			throw error;
		}
	}

	async getDockerImageTag(): Promise<string> {
		const version = await this.getLocalVersion();
		return `${this.dockerImageName}:v${version}`;
	}

	override async getDockerImageArchivePath(): Promise<string> {
		const version = await this.getLocalVersion();
		return path.resolve(
			__dirname,
			`../../../web/api/.release/bible-on-site-api-v${version}.tar.gz`,
		);
	}

	protected override getBuildCwd(): string {
		return path.resolve(__dirname, "../../../web/api");
	}

	protected override get dockerBuildContext(): string {
		return ".";
	}
}
