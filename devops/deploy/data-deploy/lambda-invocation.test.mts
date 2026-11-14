import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invokeWithRestorationRetry } from "./lambda-invocation.mts";

const restoring = () =>
	Object.assign(new Error("Resources for the function are being restored."), {
		name: "ResourceNotReadyException",
		$metadata: { httpStatusCode: 502 },
	});

describe("invokeWithRestorationRetry", () => {
	it("returns an immediately successful response without waiting", async () => {
		const response = { Payload: new Uint8Array([1, 2, 3]) };
		const result = await invokeWithRestorationRetry(
			async () => response,
			() => assert.fail("Unexpected retry log"),
			async () => assert.fail("Unexpected delay"),
		);
		assert.equal(result, response);
	});

	it("waits for VPC restoration and returns the first execution response", async () => {
		let invocations = 0;
		const delays: number[] = [];
		const messages: string[] = [];
		const response = { statusCode: 200 };
		const result = await invokeWithRestorationRetry(
			async () => {
				if (++invocations < 3) throw restoring();
				return response;
			},
			(message) => messages.push(message),
			async (delay) => {
				delays.push(delay);
			},
		);
		assert.equal(result, response);
		assert.equal(invocations, 3);
		assert.deepEqual(delays, [10_000, 10_000]);
		assert.match(messages[0], /restoring.*retry 1\/30/);
		assert.match(messages[1], /restoring.*retry 2\/30/);
	});

	it("fails with the original error when restoration never completes", async () => {
		const error = restoring();
		let invocations = 0;
		let waits = 0;
		await assert.rejects(
			invokeWithRestorationRetry(
				async () => {
					invocations++;
					throw error;
				},
				() => {},
				async () => {
					waits++;
				},
			),
			(caught) => caught === error,
		);
		assert.equal(invocations, 31);
		assert.equal(waits, 30);
	});

	for (const name of [
		"ServiceException",
		"AccessDeniedException",
		"ResourceNotFoundException",
		"TimeoutError",
	]) {
		it(`propagates ${name} without replaying a possible execution`, async () => {
			const error = Object.assign(new Error(name), {
				name,
				$metadata: { httpStatusCode: name === "ServiceException" ? 502 : 403 },
			});
			let invocations = 0;
			await assert.rejects(
				invokeWithRestorationRetry(
					async () => {
						invocations++;
						throw error;
					},
					() => assert.fail("Unexpected retry log"),
					async () => assert.fail("Unexpected delay"),
				),
				(caught) => caught === error,
			);
			assert.equal(invocations, 1);
		});
	}

	it("returns function execution failures without invoking the function again", async () => {
		const response = { FunctionError: "Unhandled" };
		const result = await invokeWithRestorationRetry(
			async () => response,
			() => assert.fail("Unexpected retry log"),
			async () => assert.fail("Unexpected delay"),
		);
		assert.equal(result, response);
	});
});
