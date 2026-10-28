import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runtime: vi.fn(),
	worker: vi.fn(),
	hook: vi.fn(),
	unhook: vi.fn(),
}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: mocks.runtime,
}));
vi.mock("~/server/ses-delivery.server", () => ({
	startEmailWorker: mocks.worker,
}));
vi.mock("nitro/app", () => ({ useNitroHooks: () => ({ hook: mocks.hook }) }));

import {
	ensureEmailWorkerStarted,
	stopEmailWorkerRuntime,
} from "~/server/email-worker-runtime.server";

const slot = Symbol.for("tanah.daily-bulletin.email-worker.v1");
const globals = globalThis as typeof globalThis & { [slot]?: unknown };
let finish: () => void;
let fail: (error: unknown) => void;
const environment = {
	BULLETIN_EMAIL_WORKER_ENABLED: "true",
	BULLETIN_SES_FROM: "bulletin@example.com",
	BULLETIN_SES_CONTACT_LIST: "bulletin",
	BULLETIN_SES_CONFIGURATION_SET: "events",
	BULLETIN_EMAIL_QUEUE_URL:
		"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	BULLETIN_SES_ACCOUNT_ID: "123456789012",
};

beforeEach(() => {
	delete globals[slot];
	vi.clearAllMocks();
	for (const [name, value] of Object.entries(environment))
		vi.stubEnv(name, value);
	mocks.runtime.mockReturnValue({ region: "il-central-1" });
	mocks.hook.mockReturnValue(mocks.unhook);
	mocks.worker.mockImplementation(
		() =>
			new Promise<void>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			}),
	);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	finish?.();
	await stopEmailWorkerRuntime().catch(() => {});
	delete globals[slot];
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

async function flush() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("email worker lifecycle", () => {
	it("importing an enabled runtime never starts the worker or loads configuration", async () => {
		await import("~/server/email-worker-runtime.server");
		expect(mocks.worker).not.toHaveBeenCalled();
		expect(mocks.runtime).not.toHaveBeenCalled();
	});
	it.each([undefined, "false", "1", "TRUE"])(
		"stays off without the exact opt-in value (%s)",
		async (value) => {
			vi.stubEnv("BULLETIN_EMAIL_WORKER_ENABLED", value);
			await ensureEmailWorkerStarted();
			expect(mocks.runtime).not.toHaveBeenCalled();
			expect(mocks.worker).not.toHaveBeenCalled();
		},
	);
	it.each([
		"BULLETIN_SES_FROM",
		"BULLETIN_SES_CONTACT_LIST",
		"BULLETIN_SES_CONFIGURATION_SET",
		"BULLETIN_EMAIL_QUEUE_URL",
		"BULLETIN_SES_ACCOUNT_ID",
	])("does not load DB/AWS modules if %s is absent", async (name) => {
		vi.stubEnv(name, "  ");
		await ensureEmailWorkerStarted();
		expect(mocks.runtime).not.toHaveBeenCalled();
		expect(mocks.worker).not.toHaveBeenCalled();
	});
	it("starts exactly once across concurrent health requests", async () => {
		await Promise.all([
			ensureEmailWorkerStarted(),
			ensureEmailWorkerStarted(),
			ensureEmailWorkerStarted(),
		]);
		await flush();
		expect(mocks.worker).toHaveBeenCalledTimes(1);
		expect(mocks.hook).toHaveBeenCalledTimes(1);
		expect(mocks.hook.mock.calls[0][0]).toBe("close");
	});
	it("reuses the singleton after a module reload", async () => {
		await ensureEmailWorkerStarted();
		vi.resetModules();
		const reloaded = await import("~/server/email-worker-runtime.server");
		await reloaded.ensureEmailWorkerStarted();
		expect(mocks.worker).toHaveBeenCalledTimes(1);
	});
	it("does not start when validated configuration is unavailable", async () => {
		mocks.runtime.mockReturnValueOnce(null);
		await ensureEmailWorkerStarted();
		expect(mocks.worker).not.toHaveBeenCalled();
		expect(mocks.hook).not.toHaveBeenCalled();
	});
	it("cancels polling on SIGTERM and the close hook waits for an in-flight attempt", async () => {
		const signals = vi.spyOn(process, "once");
		const exit = vi.spyOn(process, "exit");
		await ensureEmailWorkerStarted();
		await flush();
		const signal = mocks.worker.mock.calls[0][0] as AbortSignal;
		const handler = signals.mock.calls.find(
			(call) => call[0] === "SIGTERM",
		)?.[1] as () => void;
		expect(handler).toBeTypeOf("function");
		handler();
		expect(signal.aborted).toBe(true);
		let closed = false;
		const closing = (mocks.hook.mock.calls[0][1] as () => Promise<void>)().then(
			() => {
				closed = true;
			},
		);
		await flush();
		expect(closed).toBe(false);
		expect(exit).not.toHaveBeenCalled();
		finish();
		await closing;
		expect(closed).toBe(true);
		expect(mocks.unhook).toHaveBeenCalled();
	});
	it("manual graceful stop waits for completion and never restarts a stopping process", async () => {
		await ensureEmailWorkerStarted();
		const signal = mocks.worker.mock.calls[0][0] as AbortSignal;
		const stopped = stopEmailWorkerRuntime();
		expect(signal.aborted).toBe(true);
		finish();
		await stopped;
		await ensureEmailWorkerStarted();
		expect(mocks.worker).toHaveBeenCalledTimes(1);
	});
	it("records unexpected worker failure, reports only a generic message, and fails health requests", async () => {
		await ensureEmailWorkerStarted();
		fail(new Error("private recipient and credentials"));
		await flush();
		expect(console.error).toHaveBeenCalledWith(
			"Daily bulletin email worker stopped unexpectedly",
		);
		await expect(ensureEmailWorkerStarted()).rejects.toThrow(
			"worker stopped unexpectedly",
		);
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(mocks.worker).toHaveBeenCalledTimes(1);
	});
	it("treats unexpected normal completion as a fatal health failure", async () => {
		await ensureEmailWorkerStarted();
		finish();
		await flush();
		await expect(ensureEmailWorkerStarted()).rejects.toThrow(
			"worker stopped unexpectedly",
		);
	});
	it("surfaces sanitized initialization failure without retry storms", async () => {
		mocks.runtime.mockImplementationOnce(() => {
			throw new Error("private configuration detail");
		});
		await expect(ensureEmailWorkerStarted()).rejects.toThrow(
			"worker stopped unexpectedly",
		);
		await expect(ensureEmailWorkerStarted()).rejects.toThrow(
			"worker stopped unexpectedly",
		);
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(mocks.runtime).toHaveBeenCalledTimes(1);
		expect(mocks.worker).not.toHaveBeenCalled();
	});
	it("removes process listeners after a graceful close", async () => {
		const beforeTerm = process.listenerCount("SIGTERM");
		const beforeInt = process.listenerCount("SIGINT");
		await ensureEmailWorkerStarted();
		expect(process.listenerCount("SIGTERM")).toBe(beforeTerm + 1);
		expect(process.listenerCount("SIGINT")).toBe(beforeInt + 1);
		finish();
		const stopped = stopEmailWorkerRuntime();
		await stopped;
		expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
		expect(process.listenerCount("SIGINT")).toBe(beforeInt);
	});
});
