/** @jest-environment node */
import { register } from "../../src/instrumentation";

const GLOBAL_KEY = Symbol.for("bible-on-site.event-loop-diagnostics");
type DiagnosticsGlobal = typeof globalThis & {
	[GLOBAL_KEY]?: { running: boolean; stop(): void };
};

function globalHandle() {
	return (globalThis as DiagnosticsGlobal)[GLOBAL_KEY];
}

afterEach(() => {
	globalHandle()?.stop();
	delete process.env.NEXT_RUNTIME;
	delete process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS;
	delete process.env.EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS;
});

describe("instrumentation register", () => {
	it("starts diagnostics on the nodejs runtime when enabled", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
		// Longest allowed interval keeps the real timer quiet during the test.
		process.env.EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS = "900000";
		await register();
		expect(globalHandle()?.running).toBe(true);
	});

	it("stays inert when the flag is unset", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		await register();
		expect(globalHandle()).toBeUndefined();
	});

	it("does not start on a non-nodejs runtime", async () => {
		process.env.NEXT_RUNTIME = "edge";
		process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
		await register();
		expect(globalHandle()).toBeUndefined();
	});
});
