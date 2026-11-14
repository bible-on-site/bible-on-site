import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	spawn: vi.fn(),
	config: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: mocks.spawn,
	default: { spawn: mocks.spawn },
}));
vi.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: class {
		constructor(config: unknown) {
			mocks.config(config);
		}
		send = mocks.send;
	},
	InvokeCommand: class {
		constructor(public input: unknown) {}
	},
}));

import { renderDailyBulletin } from "~/server/render-daily.server";

const input = {
	date: "2026-10-08",
	hebrewDate: "כז תשרי תשפז",
	perekId: 1,
	article: null,
	dedications: [],
};
const artifacts = {
	subject: "עלון",
	source: "בראשית א",
	emailHtml: "<h1>עלון</h1>",
	pdfBase64: Buffer.from("%PDF-1.7").toString("base64"),
	filename: "bulletin.pdf",
};
function response(body: unknown = artifacts, base64 = false) {
	return {
		Payload: Buffer.from(
			JSON.stringify({
				statusCode: 200,
				body: base64
					? Buffer.from(JSON.stringify(body)).toString("base64")
					: JSON.stringify(body),
				isBase64Encoded: base64,
			}),
		),
	};
}
function processResult(output: unknown, code: number | null = 0) {
	let received = "";
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		stdin: new Writable({
			write(chunk, _encoding, callback) {
				received += chunk;
				callback();
			},
			final(callback) {
				callback();
				queueMicrotask(() => {
					child.stdout.write(
						typeof output === "string" ? output : JSON.stringify(output),
					);
					child.emit("close", code);
				});
			},
		}),
		kill: vi.fn(),
	});
	mocks.spawn.mockReturnValue(child);
	return { child, request: () => received };
}
describe("daily bulletin renderer transport", () => {
	beforeEach(() => {
		mocks.send.mockReset();
		mocks.spawn.mockReset();
		mocks.config.mockReset();
		vi.stubEnv("BULLETIN_LAMBDA_NAME", "");
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AWS_REGION", "");
	});
	afterEach(() => vi.unstubAllEnvs());
	it("invokes the deployed renderer once with a complete HTTP event and validates the PDF", async () => {
		mocks.send.mockResolvedValue(response());
		expect(await renderDailyBulletin(input)).toEqual(artifacts);
		const command = mocks.send.mock.calls[0][0];
		expect(command.input.FunctionName).toBe("bible-on-site-bulletin");
		const event = JSON.parse(command.input.Payload.toString());
		expect(event.rawPath).toBe("/api/preview-daily");
		expect(JSON.parse(event.body)).toEqual(input);
		expect(mocks.config).toHaveBeenCalledWith({
			region: "il-central-1",
			maxAttempts: 1,
		});
		expect(mocks.send).toHaveBeenCalledOnce();
		expect(mocks.spawn).not.toHaveBeenCalled();
	});
	it("supports configured Lambda names, regions, and base64 HTTP responses", async () => {
		vi.stubEnv("BULLETIN_LAMBDA_NAME", "test-renderer");
		vi.stubEnv("AWS_REGION", "eu-west-1");
		vi.stubEnv("NODE_ENV", "development");
		mocks.send.mockResolvedValue(response(artifacts, true));
		expect(await renderDailyBulletin(input)).toEqual(artifacts);
		expect(mocks.send.mock.calls[0][0].input.FunctionName).toBe(
			"test-renderer",
		);
		expect(mocks.config).toHaveBeenCalledWith({
			region: "eu-west-1",
			maxAttempts: 1,
		});
	});
	it.each([
		{ FunctionError: "Unhandled", Payload: Buffer.from("{}") },
		{},
		{ Payload: Buffer.from('{"statusCode":400}') },
	])(
		"rejects unsuccessful Lambda responses before returning artifacts",
		async (value) => {
			mocks.send.mockResolvedValue(value);
			await expect(renderDailyBulletin(input)).rejects.toThrow(
				"יצירת העלון נכשלה",
			);
		},
	);
	it.each([
		null,
		{ ...artifacts, source: null },
		{ ...artifacts, pdfBase64: Buffer.from("not a PDF").toString("base64") },
	])("rejects incomplete or invalid artifacts", async (value) => {
		mocks.send.mockResolvedValue(response(value));
		await expect(renderDailyBulletin(input)).rejects.toThrow(
			"יצירת העלון נכשלה",
		);
	});
	it("uses the local binary in development and sends the same immutable input", async () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("BULLETIN_BINARY_PATH", "/local/bulletin");
		const local = processResult(artifacts);
		expect(await renderDailyBulletin(input)).toEqual(artifacts);
		expect(JSON.parse(local.request())).toEqual(input);
		expect(mocks.spawn).toHaveBeenCalledWith(
			"/local/bulletin",
			["--daily-preview"],
			{ timeout: 35000, windowsHide: true },
		);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("rejects failed and oversized local output", async () => {
		vi.stubEnv("NODE_ENV", "development");
		processResult("", 1);
		await expect(renderDailyBulletin(input)).rejects.toThrow(
			"יצירת העלון נכשלה",
		);
		const oversized = processResult("x".repeat(16 * 1024 * 1024 + 1));
		await expect(renderDailyBulletin(input)).rejects.toThrow("העלון גדול מדי");
		expect(oversized.child.kill).toHaveBeenCalledOnce();
	});
});
