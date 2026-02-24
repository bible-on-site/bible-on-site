import fs from "node:fs";
import {
	GetFunctionCommand,
	LambdaClient,
	UpdateFunctionCodeCommand,
	UpdateFunctionConfigurationCommand,
	waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import {
	GetParameterCommand,
	SSMClient,
} from "@aws-sdk/client-ssm";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import * as dotenv from "dotenv";
import yargs from "yargs";
import { DeployerBase } from "../deployer-base.mjs";

dotenv.config({
	path: "./deploy/bulletin-deploy/.env",
});

const LAMBDA_FUNCTION_NAME = "bible-on-site-bulletin";
const SSM_DB_URL_PARAM = "/bible-on-site-tanah-db-url";
const STATIC_ENV_VARS: Record<string, string> = {
	FONTS_DIR: "/var/task/fonts",
	RUST_LOG: "info",
};

class BulletinDeployer extends DeployerBase {
	private readonly region: string;
	private readonly lambdaZipPath: string;
	private readonly moduleVersion: string | undefined;

	constructor(lambdaZipPath: string, moduleVersion?: string) {
		super("bulletin");

		const region = process.env.AWS_REGION;
		if (!region) {
			throw new Error("AWS_REGION environment variable is required");
		}

		this.region = region;
		this.lambdaZipPath = lambdaZipPath;
		this.moduleVersion = moduleVersion;
	}

	protected override async deployPreConditions(): Promise<void> {
		this.info("Checking preconditions...");

		if (!fs.existsSync(this.lambdaZipPath)) {
			throw new Error(
				`Lambda ZIP file not found: ${this.lambdaZipPath}`,
			);
		}

		const stats = fs.statSync(this.lambdaZipPath);
		this.info(
			`Lambda ZIP size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
		);

		if (stats.size > 50 * 1024 * 1024) {
			throw new Error(
				`Lambda ZIP exceeds 50MB limit: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
			);
		}

		this.info("Preconditions passed.");
	}

	protected override async coreDeploy(): Promise<void> {
		const client = new LambdaClient({
			region: this.region,
			credentials: fromNodeProviderChain(),
		});

		this.info(
			`Deploying to Lambda function: ${LAMBDA_FUNCTION_NAME}...`,
		);

		const zipBuffer = fs.readFileSync(this.lambdaZipPath);

		const updateResponse = await client.send(
			new UpdateFunctionCodeCommand({
				FunctionName: LAMBDA_FUNCTION_NAME,
				ZipFile: new Uint8Array(zipBuffer),
			}),
		);

		this.info(
			`Function code updated. CodeSha256: ${updateResponse.CodeSha256}`,
		);
		if (this.moduleVersion) {
			this.info(`Deployed version: ${this.moduleVersion}`);
		}

		this.info("Waiting for code update to complete...");
		await waitUntilFunctionUpdatedV2(
			{ client, maxWaitTime: 120 },
			{ FunctionName: LAMBDA_FUNCTION_NAME },
		);

		await this.ensureEnvironmentVariables(client);

		this.info("Function is active.");
	}

	private async ensureEnvironmentVariables(
		client: LambdaClient,
	): Promise<void> {
		const requiredVars = { ...STATIC_ENV_VARS };

		const ssmClient = new SSMClient({
			region: this.region,
			credentials: fromNodeProviderChain(),
		});
		const dbUrlParam = await ssmClient.send(
			new GetParameterCommand({
				Name: SSM_DB_URL_PARAM,
				WithDecryption: true,
			}),
		);
		const dbUrl = dbUrlParam.Parameter?.Value;
		if (!dbUrl) {
			throw new Error(
				`SSM parameter ${SSM_DB_URL_PARAM} not found or empty`,
			);
		}
		requiredVars.DB_URL = dbUrl;

		const current = await client.send(
			new GetFunctionCommand({ FunctionName: LAMBDA_FUNCTION_NAME }),
		);
		const existingVars =
			current.Configuration?.Environment?.Variables ?? {};

		const missing = Object.entries(requiredVars).filter(
			([key, value]) => existingVars[key] !== value,
		);

		if (missing.length === 0) {
			this.info("Environment variables already up to date.");
			return;
		}

		const merged = { ...existingVars };
		for (const [key, value] of missing) {
			const display = key === "DB_URL" ? "***" : value;
			merged[key] = value;
			this.info(`Setting env var: ${key}=${display}`);
		}

		await client.send(
			new UpdateFunctionConfigurationCommand({
				FunctionName: LAMBDA_FUNCTION_NAME,
				Environment: { Variables: merged },
			}),
		);

		this.info("Waiting for configuration update to complete...");
		await waitUntilFunctionUpdatedV2(
			{ client, maxWaitTime: 120 },
			{ FunctionName: LAMBDA_FUNCTION_NAME },
		);
		this.info("Environment variables updated.");
	}

	protected override async deployPostConditions(): Promise<void> {
		this.info("Verifying deployment...");

		const client = new LambdaClient({
			region: this.region,
			credentials: fromNodeProviderChain(),
		});

		const functionInfo = await client.send(
			new GetFunctionCommand({
				FunctionName: LAMBDA_FUNCTION_NAME,
			}),
		);

		const state = functionInfo.Configuration?.State;
		if (state !== "Active") {
			throw new Error(
				`Lambda function is in unexpected state: ${state}`,
			);
		}

		this.info(
			`Deployment verified. Runtime: ${functionInfo.Configuration?.Runtime}, ` +
				`LastModified: ${functionInfo.Configuration?.LastModified}`,
		);
	}
}

async function main() {
	const { hideBin } = await import("yargs/helpers");

	const argv = await yargs(hideBin(process.argv))
		.option("lambda-zip", {
			alias: "z",
			describe: "Path to the Lambda ZIP file",
			demandOption: true,
			type: "string",
		})
		.option("module-version", {
			alias: "v",
			describe: "Version being deployed",
			demandOption: false,
			type: "string",
		})
		.help()
		.alias("help", "h")
		.parse();

	const deployer = new BulletinDeployer(argv.lambdaZip, argv.moduleVersion);
	await deployer.deploy();
}

await main();
