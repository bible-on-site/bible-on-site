import fs from "node:fs";
import {
	GetFunctionCommand,
	LambdaClient,
	UpdateFunctionCodeCommand,
	waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import * as dotenv from "dotenv";
import yargs from "yargs";
import { DeployerBase } from "../deployer-base.mjs";

dotenv.config({
	path: "./deploy/bulletin-deploy/.env",
});

const LAMBDA_FUNCTION_NAME = "bible-on-site-bulletin";

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

		this.info("Waiting for function to become active...");
		await waitUntilFunctionUpdatedV2(
			{ client, maxWaitTime: 120 },
			{ FunctionName: LAMBDA_FUNCTION_NAME },
		);

		this.info("Function is active.");
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
