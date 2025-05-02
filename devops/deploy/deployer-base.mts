import * as semver from "semver";
import type { NodeSSH } from "node-ssh";

export abstract class DeployerBase {
	ssh: NodeSSH;
	moduleName: string;
	dockerImageName: string;
	constructor(moduleName: string, dockerImageName: string, ssh: NodeSSH) {
		this.moduleName = moduleName;
		this.dockerImageName = dockerImageName;
		this.ssh = ssh;
	}
	abstract deploy(): Promise<void>;
	abstract getLocalVersion(): Promise<string>;

	private async getRemoteModuleVersion(): Promise<string> {
		const command = `docker images ${this.dockerImageName} --format '{{.Tag}}' | grep -v '<none>' | sort -V | tail -n 1`;
		console.log(`Executing command: ${command}`);
		const result = await this.ssh.execCommand(command);
		return result.stdout;
	}
	protected async isLocalVersionNewer(): Promise<boolean> {
		const localVersion = await this.getLocalVersion();
		const remoteVersion = await this.getRemoteModuleVersion();
		console.log(`Local version: ${localVersion}`);
		console.log(`Remote version: ${remoteVersion}`);
		if (!localVersion) {
			console.log("Local version not found.");
			return false;
		}
		if (!remoteVersion) {
			console.log("Remote version not found. Assuming local is newer.");
			return true;
		}

		const localSemver = semver.valid(semver.coerce(localVersion));
		const remoteSemver = semver.valid(semver.coerce(remoteVersion));

		if (!localSemver) {
			console.error(`Invalid local version format: ${localVersion}`);
			return false; // Or handle error as appropriate
		}
		if (!remoteSemver) {
			console.warn(
				`Invalid remote version format: ${remoteVersion}. Assuming local is newer.`,
			);
			return true; // Or handle error as appropriate
		}

		const isNewer = semver.gt(localSemver, remoteSemver);
		console.log(`Is local version newer? ${isNewer}`);
		return isNewer;
	}
	protected async failIfLocalVersionNotNewer(): Promise<void> {
		const isNewer = await this.isLocalVersionNewer();
		if (!isNewer) {
			throw new Error("Local version is not newer than remote version.");
		}
	}
}
