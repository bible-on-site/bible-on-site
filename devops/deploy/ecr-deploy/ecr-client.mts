import {
	CreateRepositoryCommand,
	DescribeImagesCommand,
	DescribeRepositoriesCommand,
	ECRClient,
	GetAuthorizationTokenCommand,
	type ImageDetail,
} from "@aws-sdk/client-ecr";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromEnv, fromSSO } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@smithy/types";
import * as dotenv from "dotenv";

dotenv.config({
	path: "./deploy/ecr-deploy/.env",
});

export interface ECRConfig {
	region: string;
	accountId: string;
	profile?: string;
	/** If true, use environment credentials (for CI). Otherwise use SSO (for local). */
	useEnvCredentials?: boolean;
}

/**
 * Retry configuration for AWS API calls
 */
export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 10000,
	retryableErrors: [
		"EAI_AGAIN", // DNS temporary failure
		"ECONNRESET", // Connection reset
		"ECONNREFUSED", // Connection refused
		"ETIMEDOUT", // Connection timeout
		"ENOTFOUND", // DNS lookup failed
		"EPIPE", // Broken pipe
		"ECONNABORTED", // Connection aborted
		"TimeoutError", // SDK timeout
		"NetworkingError", // General networking error
	],
};

/**
 * Checks if an error is retryable based on error code/message
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
	if (!error || typeof error !== "object") return false;

	const errorObj = error as { code?: string; name?: string; message?: string };
	const errorCode = errorObj.code ?? "";
	const errorName = errorObj.name ?? "";
	const errorMessage = errorObj.message ?? "";

	return retryableErrors.some(
		(retryable) =>
			errorCode.includes(retryable) ||
			errorName.includes(retryable) ||
			errorMessage.includes(retryable),
	);
}

/**
 * Executes an async function with exponential backoff retry for transient errors
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
	context?: string,
): Promise<T> {
	const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
	let lastError: unknown;

	for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			if (!isRetryableError(error, opts.retryableErrors)) {
				throw error;
			}

			if (attempt === opts.maxRetries) {
				console.error(
					`${context ?? "Operation"} failed after ${opts.maxRetries} attempts: ${(error as Error).message}`,
				);
				throw error;
			}

			// Exponential backoff with jitter
			const delay = Math.min(
				opts.initialDelayMs * 2 ** (attempt - 1) + Math.random() * 1000,
				opts.maxDelayMs,
			);
			console.warn(
				`${context ?? "Operation"} failed (attempt ${attempt}/${opts.maxRetries}): ${(error as Error).message}. Retrying in ${Math.round(delay)}ms...`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

/**
 * Gets ECR configuration from environment variables.
 *
 * Authentication modes:
 * 1. **CI mode** (AWS_ACCESS_KEY_ID is set or CI=true): Uses environment credentials from OIDC
 * 2. **Local mode**: Uses AWS IAM Identity Center (SSO) via AWS_PROFILE
 *
 * Required env vars:
 * - AWS_REGION: The AWS region (e.g., us-east-1)
 *
 * For local mode (SSO):
 * - AWS_PROFILE: The SSO profile name configured via `aws configure sso`
 *
 * For CI mode (OIDC):
 * - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN: Set by aws-actions/configure-aws-credentials
 *
 * Optional env vars:
 * - AWS_ACCOUNT_ID: If not provided, will be fetched from STS
 */
export async function getECRConfig(): Promise<ECRConfig> {
	const region = process.env.AWS_REGION;
	const profile = process.env.AWS_PROFILE;

	// Detect CI mode: either explicit CI=true or AWS credentials are set (from OIDC)
	const isCI = process.env.CI === "true" || !!process.env.AWS_ACCESS_KEY_ID;
	const useEnvCredentials = isCI;

	if (!region) {
		throw new Error(
			"Missing AWS_REGION environment variable. Please check your .env file.",
		);
	}

	if (!useEnvCredentials && !profile) {
		throw new Error(
			"Missing AWS_PROFILE environment variable. Configure SSO with 'aws configure sso' and set the profile name.",
		);
	}

	// Get credentials provider based on mode
	const credentials: AwsCredentialIdentityProvider = useEnvCredentials
		? fromEnv()
		: fromSSO({ profile });

	// Get account ID from STS if not provided
	let accountId = process.env.AWS_ACCOUNT_ID;
	if (!accountId) {
		console.info("AWS_ACCOUNT_ID not set, fetching from STS...");
		const stsClient = new STSClient({
			region,
			credentials,
		});
		const identity = await withRetry(
			() => stsClient.send(new GetCallerIdentityCommand({})),
			{},
			"STS GetCallerIdentity",
		);
		accountId = identity.Account;
		if (!accountId) {
			throw new Error("Failed to get AWS Account ID from STS");
		}
		console.info(`Using AWS Account ID: ${accountId}`);
	}

	if (useEnvCredentials) {
		console.info("Using environment credentials (CI/OIDC mode)");
	} else {
		console.info(`Using SSO profile: ${profile}`);
	}

	return { region, accountId, profile, useEnvCredentials };
}

export function createECRClient(config: ECRConfig): ECRClient {
	const credentials: AwsCredentialIdentityProvider = config.useEnvCredentials
		? fromEnv()
		: fromSSO({ profile: config.profile });

	return new ECRClient({
		region: config.region,
		credentials,
	});
}

export async function getAuthorizationToken(
	client: ECRClient,
): Promise<{ username: string; password: string; proxyEndpoint: string }> {
	const command = new GetAuthorizationTokenCommand({});
	const response = await withRetry(
		() => client.send(command),
		{},
		"ECR GetAuthorizationToken",
	);

	if (!response.authorizationData?.[0]) {
		throw new Error("Failed to get ECR authorization token");
	}

	const authData = response.authorizationData[0];
	if (!authData.authorizationToken || !authData.proxyEndpoint) {
		throw new Error(
			"Invalid ECR authorization data: missing token or endpoint",
		);
	}
	const token = Buffer.from(authData.authorizationToken, "base64").toString(
		"utf-8",
	);
	const [username, password] = token.split(":");

	return {
		username,
		password,
		proxyEndpoint: authData.proxyEndpoint,
	};
}

export async function ensureRepositoryExists(
	client: ECRClient,
	repositoryName: string,
): Promise<string> {
	try {
		const describeCommand = new DescribeRepositoriesCommand({
			repositoryNames: [repositoryName],
		});
		const response = await withRetry(
			() => client.send(describeCommand),
			{},
			"ECR DescribeRepositories",
		);
		const repositoryUri = response.repositories?.[0]?.repositoryUri;
		if (!repositoryUri) {
			throw new Error(`Repository ${repositoryName} found but has no URI`);
		}
		return repositoryUri;
	} catch (error: unknown) {
		if ((error as { name?: string }).name === "RepositoryNotFoundException") {
			console.info(`Repository ${repositoryName} not found, creating...`);
			const createCommand = new CreateRepositoryCommand({
				repositoryName,
				imageScanningConfiguration: { scanOnPush: true },
				imageTagMutability: "MUTABLE",
			});
			const response = await withRetry(
				() => client.send(createCommand),
				{},
				"ECR CreateRepository",
			);
			const repositoryUri = response.repository?.repositoryUri;
			if (!repositoryUri) {
				throw new Error(`Failed to create repository ${repositoryName}`);
			}
			console.info(`Repository ${repositoryName} created successfully`);
			return repositoryUri;
		}
		throw error;
	}
}

export async function getRemoteImageTags(
	client: ECRClient,
	repositoryName: string,
): Promise<string[]> {
	try {
		const command = new DescribeImagesCommand({
			repositoryName,
		});
		const response = await withRetry(
			() => client.send(command),
			{},
			"ECR DescribeImages",
		);

		if (!response.imageDetails) {
			return [];
		}

		const tags = response.imageDetails
			.flatMap((img: ImageDetail) => img.imageTags ?? [])
			.filter((tag: string) => tag !== "latest");

		// Sort by semantic version
		return tags.sort((a: string, b: string) => {
			const semverA = a.replace(/^v/, "");
			const semverB = b.replace(/^v/, "");
			return semverA.localeCompare(semverB, undefined, {
				numeric: true,
				sensitivity: "base",
			});
		});
	} catch (error: unknown) {
		if ((error as { name?: string }).name === "RepositoryNotFoundException") {
			return [];
		}
		throw error;
	}
}

export function getECRRepositoryUri(
	config: ECRConfig,
	repositoryName: string,
): string {
	return `${config.accountId}.dkr.ecr.${config.region}.amazonaws.com/${repositoryName}`;
}
