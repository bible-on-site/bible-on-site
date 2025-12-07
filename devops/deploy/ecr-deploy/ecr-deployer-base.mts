import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ECRClient } from "@aws-sdk/client-ecr";
import * as semver from "semver";
import {
	type ECRConfig,
	ensureRepositoryExists,
	getAuthorizationToken,
	getRemoteImageTags,
	withRetry,
} from "./ecr-client.mjs";

export enum Diff {
	LocalNewer = "LocalNewer",
	RemoteNewer = "RemoteNewer",
	LocalRemoteSame = "LocalRemoteSame",
}

export abstract class ECRDeployerBase {
	protected wrappedLocalVersion?: string;

	constructor(
		protected readonly moduleName: string,
		protected readonly dockerImageName: string,
		protected readonly ecrRepositoryName: string,
		protected readonly client: ECRClient,
		protected readonly config: ECRConfig,
	) {}

	async deploy(): Promise<void> {
		this.info(`Deploying ${this.moduleName} to ECR...`);
		await this.deployPreConditions();
		await this.coreDeploy();
		await this.deployPostConditions();
		this.info(
			`Deployment of ${this.moduleName} to ECR completed successfully.`,
		);
	}

	public setLocalVersion(version: string | undefined): void {
		this.wrappedLocalVersion = version;
	}

	protected abstract getLocalVersion(): Promise<string>;
	protected abstract getDockerImageTag(): Promise<string>;

	protected get dockerBuildContext(): string {
		return ".";
	}

	protected get dockerfilePath(): string {
		return "Dockerfile";
	}

	protected async getRemoteVersion(): Promise<string | undefined> {
		const tags = await getRemoteImageTags(this.client, this.ecrRepositoryName);
		if (tags.length === 0) {
			return undefined;
		}
		return tags[tags.length - 1]; // Return the latest version
	}

	private async localRemoteVersionDiff(): Promise<Diff> {
		const localVersion = await this.getLocalVersion();
		const remoteVersion = await this.getRemoteVersion();
		this.info(`Local version: ${localVersion}`);
		this.info(`Remote version: ${remoteVersion ?? "not found"}`);

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
			return Diff.RemoteNewer;
		}
		if (!remoteSemver) {
			this.warn(
				`Invalid remote version format: ${remoteVersion}. Assuming local is newer.`,
			);
			return Diff.LocalNewer;
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

	protected async deployPreConditions(): Promise<void> {
		this.info("Checking preconditions for deployment...");
		try {
			const diff = await this.localRemoteVersionDiff();
			if (diff !== Diff.LocalNewer) {
				throw new Error("Local version is not newer than remote version.");
			}
		} catch (error) {
			this.error(
				`Preconditions for deployment failed: ${(error as { message?: string }).message}`,
			);
			throw error;
		}
		this.info("Preconditions for deployment passed.");
	}

	protected async deployPostConditions(): Promise<void> {
		this.info("Checking postconditions for deployment...");

		await withRetry(
			async () => {
				// Verify the image was pushed successfully
				const tags = await getRemoteImageTags(
					this.client,
					this.ecrRepositoryName,
				);
				const localVersion = await this.getLocalVersion();
				const expectedTag = `v${localVersion}`;
				if (!tags.includes(expectedTag)) {
					// Throw a retryable error
					const error = new Error(
						`Image with tag ${expectedTag} was not found in ECR after push.`,
					);
					(error as Error & { code?: string }).code = "ECONNABORTED";
					throw error;
				}
			},
			{ maxRetries: 5, initialDelayMs: 2000 },
			"ECR postcondition verification",
		);

		this.info("Postconditions for deployment passed.");
	}

	private async coreDeploy(): Promise<void> {
		this.info("Starting core deployment to ECR...");

		// Ensure repository exists
		const repositoryUri = await ensureRepositoryExists(
			this.client,
			this.ecrRepositoryName,
		);
		this.info(`Using ECR repository: ${repositoryUri}`);

		// Authenticate Docker with ECR
		await this.authenticateDocker();

		// Build, tag, and push the image
		await this.buildAndPushImage(repositoryUri);

		this.info("Core deployment to ECR completed.");
	}

	private async authenticateDocker(): Promise<void> {
		this.info("Authenticating Docker with ECR...");
		const auth = await getAuthorizationToken(this.client);

		// Try using AWS CLI method first (more reliable on Windows)
		const awsCliResult = spawnSync(
			"aws",
			[
				"ecr",
				"get-login-password",
				"--region",
				this.config.region,
				"--profile",
				this.config.profile ?? "",
			],
			{ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		);

		const password =
			awsCliResult.status === 0 ? awsCliResult.stdout.trim() : auth.password;

		// Use spawnSync with input to safely pass password via stdin
		const result = spawnSync(
			"docker",
			["login", "--username", "AWS", "--password-stdin", auth.proxyEndpoint],
			{
				input: password,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			},
		);

		if (result.status !== 0) {
			const errorMsg = result.stderr || String(result.error) || "Unknown error";
			// Check if it's a credential store issue - try fallback
			if (
				errorMsg.includes("error storing credentials") ||
				errorMsg.includes("stub received bad data")
			) {
				this.warn(
					"Docker credential store issue detected. Attempting direct config fallback...",
				);
				await this.authenticateDockerDirectConfig(auth.proxyEndpoint, password);
				return;
			}
			throw new Error(`Failed to authenticate Docker with ECR: ${errorMsg}`);
		}
		this.info("Docker authenticated with ECR successfully.");
	}

	/**
	 * Fallback authentication method that writes directly to Docker config
	 * This bypasses the credential store which can have issues on Windows
	 */
	private async authenticateDockerDirectConfig(
		registry: string,
		password: string,
	): Promise<void> {
		const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");

		let config: {
			auths?: Record<string, { auth?: string }>;
			credsStore?: string;
			credHelpers?: Record<string, string>;
			[key: string]: unknown;
		} = {};

		try {
			const existingConfig = fs.readFileSync(dockerConfigPath, "utf-8");
			config = JSON.parse(existingConfig);
		} catch {
			// Config doesn't exist or is invalid, start fresh
		}

		// Remove credsStore temporarily - it prevents auths from being used
		// We'll use credHelpers to specify per-registry credential handling
		delete config.credsStore;

		// Ensure credHelpers exists and set ECR to use no helper (use auths instead)
		config.credHelpers = config.credHelpers ?? {};

		// Extract the registry host (without https://)
		const registryHost = registry.replace(/^https?:\/\//, "");

		// Ensure auths object exists
		config.auths = config.auths ?? {};

		// Add the ECR registry auth (base64 encoded "AWS:password")
		const authString = Buffer.from(`AWS:${password}`).toString("base64");
		config.auths[registryHost] = { auth: authString };
		// Also add with https:// prefix for compatibility
		config.auths[registry] = { auth: authString };

		// Write back the config
		fs.mkdirSync(path.dirname(dockerConfigPath), { recursive: true });
		fs.writeFileSync(dockerConfigPath, JSON.stringify(config, null, "\t"));

		this.info(
			"Docker authenticated with ECR successfully (via direct config).",
		);
	}

	private async buildAndPushImage(repositoryUri: string): Promise<void> {
		const localVersion = await this.getLocalVersion();
		const imageTag = await this.getDockerImageTag();
		const versionTag = `v${localVersion}`;

		// Full ECR image URIs
		const ecrImageUri = `${repositoryUri}:${versionTag}`;
		const ecrLatestUri = `${repositoryUri}:latest`;

		this.info(`Building Docker image: ${imageTag}`);

		// Check if image exists locally
		try {
			execSync(`docker image inspect ${imageTag}`, { stdio: "pipe" });
			this.info(`Using existing local image: ${imageTag}`);
		} catch {
			// Image doesn't exist, need to build it
			this.info(`Local image not found. Building from Dockerfile...`);
			const buildCommand = `docker build -t ${imageTag} -f ${this.dockerfilePath} ${this.dockerBuildContext}`;
			execSync(buildCommand, { stdio: "inherit", cwd: this.getBuildCwd() });
		}

		// Tag for ECR
		this.info(`Tagging image as ${ecrImageUri}`);
		execSync(`docker tag ${imageTag} ${ecrImageUri}`, { stdio: "inherit" });
		execSync(`docker tag ${imageTag} ${ecrLatestUri}`, { stdio: "inherit" });

		// Push to ECR
		this.info(`Pushing image to ECR: ${ecrImageUri}`);
		execSync(`docker push ${ecrImageUri}`, { stdio: "inherit" });
		this.info(`Pushing latest tag to ECR: ${ecrLatestUri}`);
		execSync(`docker push ${ecrLatestUri}`, { stdio: "inherit" });

		this.info(`Image pushed to ECR successfully: ${ecrImageUri}`);
	}

	protected getBuildCwd(): string {
		return process.cwd();
	}

	protected info(message: string): void {
		console.info(`[ECR:${this.moduleName}] ${message}`);
	}
	protected warn(message: string): void {
		console.warn(`[ECR:${this.moduleName}] ${message}`);
	}
	protected error(message: string): void {
		console.error(`[ECR:${this.moduleName}] ${message}`);
	}
}
