import * as semver from "semver";
import type { NodeSSH } from "node-ssh";
import fs from "node:fs";

export enum Diff {
	LocalNewer = "LocalNewer",
	RemoteNewer = "RemoteNewer",
	LocalRemoteSame = "LocalRemoteSame",
}

export abstract class DeployerBase {
	ssh: NodeSSH;
	moduleName: string;
	dockerImageName: string;
	wrappedLocalVersion?: string;

	constructor(moduleName: string, dockerImageName: string, ssh: NodeSSH) {
		this.moduleName = moduleName;
		this.dockerImageName = dockerImageName;
		this.ssh = ssh;
	}
	async deploy(): Promise<void> {
		console.info(`Deploying ${this.moduleName}...`);
		await this.deployPreConditions();
		await this.coreDeploy();
		await this.deployPostConditions();
		await this.postDeploy();
	}
	postDeploy(): Promise<void> {
		return Promise.resolve();
	}
	getLocalVersion(): Promise<string | undefined> {
		return Promise.resolve(this.wrappedLocalVersion);
	}
	abstract getDockerImageTarGzPath(): Promise<string>;
	setLocalVersion(version: string | undefined): void {
		this.wrappedLocalVersion = version;
	}
	private async getRemoteModuleVersion(): Promise<string> {
		const command = `docker images ${this.dockerImageName} --format '{{.Tag}}' | grep -v '<none>' | sort -V | tail -n 1`;
		console.info(`Executing command: ${command}`);
		const result = await this.ssh.execCommand(command);
		return result.stdout;
	}

	private async localRemoteVersionDiff(): Promise<Diff> {
		const localVersion = await this.getLocalVersion();
		const remoteVersion = await this.getRemoteModuleVersion();
		console.info(`Local version: ${localVersion}`);
		console.info(`Remote version: ${remoteVersion}`);

		if (!localVersion) {
			console.info("Local version not found.");
			return Diff.RemoteNewer;
		}
		if (!remoteVersion) {
			console.info("Remote version not found. Assuming local is newer.");
			return Diff.LocalNewer;
		}

		const localSemver = semver.valid(semver.coerce(localVersion));
		const remoteSemver = semver.valid(semver.coerce(remoteVersion));

		if (!localSemver) {
			console.error(`Invalid local version format: ${localVersion}`);
			return Diff.RemoteNewer; // Or handle error as appropriate
		}
		if (!remoteSemver) {
			console.warn(
				`Invalid remote version format: ${remoteVersion}. Assuming local is newer.`,
			);
			return Diff.LocalNewer; // Or handle error as appropriate
		}

		if (semver.gt(localSemver, remoteSemver)) {
			console.info("Local version is newer than remote version.");
			return Diff.LocalNewer;
		}
		if (semver.lt(localSemver, remoteSemver)) {
			console.info("Remote version is newer than local version.");
			return Diff.RemoteNewer;
		}
		console.info("Local and remote versions are the same.");
		return Diff.LocalRemoteSame;
	}

	protected async failIfLocalVersionNotNewer(): Promise<void> {
		const diff = await this.localRemoteVersionDiff();
		if (diff !== Diff.LocalNewer) {
			throw new Error("Local version is not newer than remote version.");
		}
	}
	private async failIfImageTarGzNotExists(): Promise<void> {
		const exists = fs.existsSync(await this.getDockerImageTarGzPath());
		if (!exists) {
			throw new Error(
				`Docker image tar.gz file does not exist: ${await this.getDockerImageTarGzPath()}`,
			);
		}
	}
	protected async failIfRemoteVersionNotTheSameAsLocal(): Promise<void> {
		const diff = await this.localRemoteVersionDiff();
		if (diff !== Diff.LocalRemoteSame) {
			throw new Error("Remote version is not the same as local version.");
		}
	}
	protected async deployPreConditions(): Promise<void> {
		console.info(`Checking preconditions for ${this.moduleName} deployment...`);
		try {
			await this.failIfImageTarGzNotExists();
			await this.failIfLocalVersionNotNewer();
		} catch (error) {
			console.error(
				`Preconditions for ${this.moduleName} deployment failed: ${
					(error as { message?: string }).message
				}`,
			);
			throw error;
		}
		console.info(`Preconditions for ${this.moduleName} deployment passed.`);
	}
	protected async deployPostConditions() {
		console.info(
			`Checking postconditions for ${this.moduleName} deployment...`,
		);
		try {
			await this.failIfRemoteVersionNotTheSameAsLocal();
		} catch (error) {
			console.error(
				`Postconditions for ${this.moduleName} deployment failed: ${
					(error as { message?: string }).message
				}`,
			);
			throw error;
		}
		console.info(`Postconditions for ${this.moduleName} deployment passed.`);
	}
	private async coreDeploy(): Promise<void> {
		console.info(`Starting core deployment for ${this.moduleName}...`);
		await this.deployDockerImage();
		console.info(`Core deployment for ${this.moduleName} completed.`);
	}
	private async deployDockerImage(): Promise<void> {
		console.info(`Deploying Docker image for ${this.moduleName}...`);
	}
}
