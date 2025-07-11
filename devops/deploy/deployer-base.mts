// General comment: This file was created by extensive use of vibe coding.
// I'm not proud of it, but it makes the job.
// Priority for improvment the quality depends on fragility which will be cleared by time.
import * as semver from "semver";
import fs from "node:fs";
import type { SSHConnection } from "./ssh/ssh-connection.mjs";

export enum Diff {
	LocalNewer = "LocalNewer",
	RemoteNewer = "RemoteNewer",
	LocalRemoteSame = "LocalRemoteSame",
}

export abstract class DeployerBase {
	wrappedLocalVersion?: string;

	constructor(
		protected readonly moduleName: string,
		private readonly dockerImageName: string,
		private readonly connection: SSHConnection,
	) {}

	public dispose(): void {
		this.connection.drop();
	}

	async deploy(): Promise<void> {
		this.info(`Deploying ${this.moduleName}...`);
		await this.deployPreConditions();
		await this.coreDeploy();
		await this.deployPostConditions();
		await this.postDeploy();
	}
	async finalizeDeployment() {
		await this.removeOldDockerContainers();
		await this.removeOldDockerImages();
	}
	async rollback() {
		await this.stopNewDockerContainers();
		await this.startOldDockerContainers();
		await this.removeNewDockerImages();
	}
	protected async getDescription(): Promise<string> {
		return `${this.moduleName}:${await this.getLocalVersion()}@(${this.connection.config.name})`;
	}
	protected async postDeploy(): Promise<void> {
		return Promise.resolve();
	}
	protected async getLocalVersion(): Promise<string | undefined> {
		return Promise.resolve(this.wrappedLocalVersion);
	}
	abstract getDockerImageTarGzPath(): Promise<string>;

	// TODO: (1) refactor into dictionary, (2) return the hardcoded run options (3) from derived classes extend super call results
	protected get dockerRunOptions(): string {
		return "";
	}
	public setLocalVersion(version: string | undefined): void {
		this.wrappedLocalVersion = version;
	}
	private async getRemoteModuleVersion(): Promise<string | undefined> {
		return this.getRemoteVersionByOffset(0); // Latest version
	}

	private async getRemoteVersionByOffset(
		offset: number,
	): Promise<string | undefined> {
		const tailCount = offset + 1;
		const command = `docker images ${this.dockerImageName} --format '{{.Tag}}' | grep -v '<none>' | sort -V | tail -n ${tailCount} | head -n 1`;
		this.info(`Executing command: ${command}`);
		const result = await this.connection.client?.execCommand(command);
		return result?.stdout?.trim();
	}

	private async getPreviousRemoteVersion(): Promise<string | undefined> {
		return this.getRemoteVersionByOffset(1); // Previous version
	}

	private async localRemoteVersionDiff(): Promise<Diff> {
		const localVersion = await this.getLocalVersion();
		const remoteVersion = await this.getRemoteModuleVersion();
		this.info(`Local version: ${localVersion}`);
		this.info(`Remote version: ${remoteVersion}`);

		if (!localVersion) {
			this.info("Local version not found.");
			return Diff.RemoteNewer;
		}
		if (!remoteVersion) {
			this.info("Remote version not found. Assuming local is newer.");
			return Diff.LocalNewer;
		}

		const localSemver = semver.valid(semver.coerce(localVersion));
		const remoteSemver = semver.valid(semver.coerce(remoteVersion));

		if (!localSemver) {
			this.error(`Invalid local version format: ${localVersion}`);
			return Diff.RemoteNewer; // Or handle error as appropriate
		}
		if (!remoteSemver) {
			this.warn(
				`Invalid remote version format: ${remoteVersion}. Assuming local is newer.`,
			);
			return Diff.LocalNewer; // Or handle error as appropriate
		}

		if (semver.gt(localSemver, remoteSemver)) {
			this.info("Local version is newer than remote version.");
			return Diff.LocalNewer;
		}
		if (semver.lt(localSemver, remoteSemver)) {
			this.info("Remote version is newer than local version.");
			return Diff.RemoteNewer;
		}
		this.info("Local and remote versions are the same.");
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
		await this.info("Checking preconditions for deployment...");
		try {
			await this.failIfImageTarGzNotExists();
			await this.failIfLocalVersionNotNewer();
		} catch (error) {
			await this.error(
				`Preconditions for deployment failed: ${
					(error as { message?: string }).message
				}`,
			);
			throw error;
		}
		await this.info("Preconditions for deployment passed.");
	}
	protected async deployPostConditions() {
		await this.info("Checking postconditions for deployment...");
		try {
			await this.failIfRemoteVersionNotTheSameAsLocal();
		} catch (error) {
			await this.error(
				`Postconditions for deployment failed: ${
					(error as { message?: string }).message
				}`,
			);
			throw error;
		}
		await this.info("Postconditions for deployment passed.");
	}
	private async coreDeploy(): Promise<void> {
		await this.info("Starting core deployment...");
		await this.deployDockerImage();
		await this.stopOldDockerContainers();
		await this.startNewDockerContainers();
		await this.info("Core deployment completed.");
	}
	private async deployDockerImage(): Promise<void> {
		await this.info("Deploying Docker image...");
		const localTarPath = await this.getDockerImageTarGzPath();

		// Stream the tar.gz file directly to docker load without storing it on remote
		await this.info(`Streaming ${localTarPath} directly to docker load...`);
		const fileStream = fs.createReadStream(localTarPath);

		const loadResult = await this.connection.client?.execCommand(
			"docker load",
			{
				stdin: fileStream,
			},
		);

		if (loadResult?.code !== 0) {
			throw new Error(`Failed to load Docker image: ${loadResult?.stderr}`);
		}

		await this.info("Docker image deployed successfully.");
	} // Core container operations
	private async manageContainers(
		action: "stop" | "start" | "remove",
		filters: { status?: string; version?: string },
		namePrefix?: string,
	): Promise<void> {
		const actionVerb = this.getActionVerb(action);
		await this.info(`${actionVerb} Docker containers...`);

		if (action === "start") {
			return this.startContainerWithVersion(filters.version, namePrefix);
		}

		const containerIds = await this.getContainerIds(filters);

		if (containerIds.length === 0) {
			const statusFilter = filters.status
				? ` with status ${filters.status}`
				: "";
			const versionFilter = filters.version
				? ` for version ${filters.version}`
				: "";
			await this.info(
				`No containers found${statusFilter}${versionFilter} for ${this.dockerImageName}`,
			);
			return;
		}

		await Promise.all(
			containerIds.map((containerId) =>
				this.executeContainerAction(action, containerId),
			),
		);
	}

	private getActionVerb(action: "stop" | "start" | "remove"): string {
		switch (action) {
			case "remove":
				return "Removing";
			case "stop":
				return "Stopping";
			case "start":
				return "Starting";
		}
	}
	private async getContainerIds(filters: {
		status?: string;
		version?: string;
	}): Promise<string[]> {
		// Build the search command based on filters
		let searchCommand = `docker ps -a --format "{{.ID}} {{.Image}} {{.Status}}"`;

		// Apply image and version filtering
		if (filters.version) {
			searchCommand += ` | grep "${this.dockerImageName}:${filters.version}"`;
		} else {
			searchCommand += ` | grep "${this.dockerImageName}:"`;
		}

		// Apply status filtering if specified
		if (filters.status) {
			searchCommand += ` | grep "${filters.status}"`;
		}

		// Extract just the container IDs
		searchCommand += " | awk '{print $1}'";

		this.debug(`Executing container search: ${searchCommand}`);
		const result = await this.connection.client?.execCommand(searchCommand);

		if (result?.code !== 0) {
			this.warn(`Container search failed: ${result?.stderr}`);
			return [];
		}

		const containerIds = result?.stdout?.trim()
			? result.stdout
					.trim()
					.split("\n")
					.filter((id) => id.length > 0)
			: [];

		this.debug(
			`Found ${containerIds.length} containers: [${containerIds.join(", ")}]`,
		);
		return containerIds;
	}

	private async executeContainerAction(
		action: "stop" | "remove",
		containerId: string,
	): Promise<void> {
		this.info(
			`${action === "stop" ? "Stopping" : "Removing"} container ${containerId}...`,
		);
		const result = await this.connection.client?.execCommand(
			`docker ${action} ${containerId}`,
		);

		if (result?.code !== 0) {
			this.warn(
				`Failed to ${action} container ${containerId}: ${result?.stderr}`,
			);
		}
	}

	private async startContainerWithVersion(
		version?: string,
		namePrefix?: string,
	): Promise<void> {
		if (!version) {
			this.warn("Version not specified for container start");
			return;
		}

		const containerName =
			namePrefix ?? `${this.dockerImageName}-${version}-${Date.now()}`;
		const runCommand = `docker run -d --name ${containerName} ${this.dockerRunOptions} ${this.dockerImageName}:${version} &`;
		this.info(`Executing command: ${runCommand}`);

		const runResult = await this.connection.client?.execCommand(runCommand);

		if (runResult?.code !== 0) {
			throw new Error(`Failed to start container: ${runResult?.stderr}`);
		}

		this.info(`Container started successfully: ${runResult?.stdout?.trim()}`);
	} // Core image operations
	private async getImageVersions(filterCommand: string): Promise<string[]> {
		const result = await this.connection.client?.execCommand(filterCommand);
		return result?.stdout?.trim() ? result.stdout.trim().split("\n") : [];
	}

	private async removeImageVersion(version: string): Promise<void> {
		const imageTag = `${this.dockerImageName}:${version}`;
		this.info(`Removing image ${imageTag}...`);

		const removeResult = await this.connection.client?.execCommand(
			`docker rmi ${imageTag}`,
		);

		if (removeResult?.code !== 0) {
			this.warn(`Failed to remove image ${imageTag}: ${removeResult?.stderr}`);
		} else {
			this.info(`Successfully removed image ${imageTag}`);
		}
	} // Specific operations using shared functions
	private async stopOldDockerContainers(): Promise<void> {
		await this.manageContainers("stop", { status: "Up" });
	}

	private async startNewDockerContainers(): Promise<void> {
		const localVersion = await this.getLocalVersion();
		if (!localVersion) {
			throw new Error("Local version not found for starting new containers");
		}
		await this.manageContainers("start", { version: localVersion });
	}
	private async removeOldDockerContainers(): Promise<void> {
		// Remove both Exited and Created containers to free up image references
		// TODO: improve the filter to be able to receive both instead of two calls
		await this.manageContainers("remove", { status: "Exited" });
		await this.manageContainers("remove", { status: "Created" });
	}

	private async stopNewDockerContainers(): Promise<void> {
		const localVersion = await this.getLocalVersion();
		if (!localVersion) {
			this.warn("Local version not found, cannot stop new containers");
			return;
		}
		await this.manageContainers("stop", { version: localVersion });
	}

	private async startOldDockerContainers(): Promise<void> {
		const previousVersion = await this.getPreviousRemoteVersion();
		if (!previousVersion) {
			this.warn("No previous version found to rollback to");
			return;
		}
		await this.manageContainers(
			"start",
			{ version: previousVersion },
			`${this.dockerImageName}-${previousVersion}-rollback`,
		);
	}
	private async removeOldDockerImages(): Promise<void> {
		await this.info("Removing old Docker image");

		const localVersion = await this.getLocalVersion();
		if (!localVersion) {
			await this.warn("Local version not found, skipping old image removal");
			return;
		}

		const listCommand = `docker images ${this.dockerImageName} --format "{{.Tag}}" | grep -v "^${localVersion}$" | grep -v "<none>"`;
		const oldVersions = await this.getImageVersions(listCommand);

		if (oldVersions.length === 0) {
			await this.info(`No old images found for ${this.dockerImageName}`);
			return;
		}

		await Promise.all(
			oldVersions.map((version) => this.removeImageVersion(version)),
		);
	}

	private async removeNewDockerImages(): Promise<void> {
		const localVersion = await this.getLocalVersion();
		if (!localVersion) {
			this.warn("Local version not found, cannot remove new images");
			return;
		}
		await this.removeImageVersion(localVersion);
	}
	protected async debug(message: string): Promise<void> {
		console.debug(`[${await this.getDescription()}] ${message}`);
	}
	protected async info(message: string): Promise<void> {
		console.info(`[${await this.getDescription()}] ${message}`);
	}
	protected async warn(message: string): Promise<void> {
		console.warn(`[${await this.getDescription()}] ${message}`);
	}
	protected async error(message: string): Promise<void> {
		console.error(`[${await this.getDescription()}] ${message}`);
	}
}
