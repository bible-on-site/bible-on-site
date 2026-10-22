import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
	GetFunctionCommand,
	type LambdaClient,
	UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import type { SSMClient } from "@aws-sdk/client-ssm";
import { SSM_DB_URL_PARAM, ensureDbUrlEnvVar } from "./lambda-env.mts";

const DB_URL = "mysql://admin:secret@db.internal:3306/tanah";

const ssmStub = (value: string | undefined) =>
	({
		send: mock.fn(async () => ({
			Parameter: value === undefined ? {} : { Value: value },
		})),
	}) as unknown as SSMClient;

const lambdaStub = (variables: Record<string, string>) => {
	const calls: { name: string; input: Record<string, unknown> }[] = [];
	const client = {
		send: mock.fn(async (command: GetFunctionCommand | UpdateFunctionConfigurationCommand) => {
			calls.push({ name: command.constructor.name, input: command.input });
			if (command instanceof GetFunctionCommand) {
				return {
					Configuration: {
						State: "Active",
						LastUpdateStatus: "Successful",
						Environment: { Variables: variables },
					},
				};
			}
			return {};
		}),
	} as unknown as LambdaClient;
	return { client, calls };
};

const noop = () => {};

describe("ensureDbUrlEnvVar", () => {
	it("injects DB_URL into the Lambda environment, preserving other vars", async () => {
		const { client, calls } = lambdaStub({ S3_BUCKET: "bucket" });

		await ensureDbUrlEnvVar(client, ssmStub(DB_URL), "fn", noop);

		const update = calls.find(
			(c) => c.name === "UpdateFunctionConfigurationCommand",
		);
		assert.ok(update, "expected an UpdateFunctionConfiguration call");
		assert.deepEqual(update.input.Environment, {
			Variables: { S3_BUCKET: "bucket", DB_URL },
		});
	});

	it("does not update the function when DB_URL already matches", async () => {
		const { client, calls } = lambdaStub({ DB_URL, S3_BUCKET: "bucket" });
		const messages: string[] = [];

		await ensureDbUrlEnvVar(client, ssmStub(DB_URL), "fn", (m) =>
			messages.push(m),
		);

		assert.ok(
			!calls.some((c) => c.name === "UpdateFunctionConfigurationCommand"),
		);
		assert.match(messages[0] ?? "", /already up to date/);
	});

	it("fails when the SSM parameter is missing", async () => {
		const { client, calls } = lambdaStub({});

		await assert.rejects(
			ensureDbUrlEnvVar(client, ssmStub(undefined), "fn", noop),
			(err: Error) => {
				assert.ok(err.message.includes(SSM_DB_URL_PARAM));
				return true;
			},
		);
		assert.ok(
			!calls.some((c) => c.name === "UpdateFunctionConfigurationCommand"),
		);
	});

	it("never logs the DB_URL value", async () => {
		const { client } = lambdaStub({});
		const messages: string[] = [];

		await ensureDbUrlEnvVar(client, ssmStub(DB_URL), "fn", (m) =>
			messages.push(m),
		);

		assert.ok(messages.every((m) => !m.includes(DB_URL)));
	});
});
