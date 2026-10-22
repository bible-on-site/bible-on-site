import {
	GetFunctionCommand,
	type LambdaClient,
	UpdateFunctionConfigurationCommand,
	waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";

export const SSM_DB_URL_PARAM = "bible-on-site-tanah-db-url";

// The populator Lambda reads its DB credentials from this environment variable
// instead of calling SSM from inside the VPC. Injecting it at deploy time lets
// the SSM interface endpoint (hourly cost) be removed; the deployer's OIDC role
// already holds ssm:GetParameter on bible-on-site-tanah-db-*.
export async function ensureDbUrlEnvVar(
	lambdaClient: LambdaClient,
	ssmClient: SSMClient,
	functionName: string,
	info: (message: string) => void,
): Promise<void> {
	const param = await ssmClient.send(
		new GetParameterCommand({
			Name: SSM_DB_URL_PARAM,
			WithDecryption: true,
		}),
	);
	const dbUrl = param.Parameter?.Value;
	if (!dbUrl) {
		throw new Error(
			`SSM parameter ${SSM_DB_URL_PARAM} not found or empty`,
		);
	}

	const current = await lambdaClient.send(
		new GetFunctionCommand({ FunctionName: functionName }),
	);
	const existingVars =
		current.Configuration?.Environment?.Variables ?? {};
	if (existingVars.DB_URL === dbUrl) {
		info("Lambda environment variable DB_URL is already up to date.");
		return;
	}

	await lambdaClient.send(
		new UpdateFunctionConfigurationCommand({
			FunctionName: functionName,
			Environment: { Variables: { ...existingVars, DB_URL: dbUrl } },
		}),
	);
	info("Lambda environment updated: DB_URL=***");

	await waitUntilFunctionUpdatedV2(
		{ client: lambdaClient, maxWaitTime: 300 },
		{ FunctionName: functionName },
	);
	info("Lambda configuration update completed.");
}
