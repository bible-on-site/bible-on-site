/** @jest-environment node */

const GLOBAL_KEY = Symbol.for("bible-on-site.event-loop-diagnostics");
const IMPORT_COUNT = Symbol.for("bible-on-site.test.sefarim-imports");
const EMPTY_FLAG = Symbol.for("bible-on-site.test.sefarim-empty");
type DiagnosticsGlobal = typeof globalThis & {
	[GLOBAL_KEY]?: { running: boolean; stop(): void };
};

jest.mock("../../src/data/db/sefarim", () => {
	const g = globalThis as Record<symbol, unknown>;
	g[IMPORT_COUNT] = ((g[IMPORT_COUNT] as number | undefined) ?? 0) + 1;
	return { sefarim: g[EMPTY_FLAG] === true ? [] : [{ id: 1 }] };
});

async function freshRegister() {
	jest.resetModules();
	const { register } = await import("../../src/instrumentation");
	return register;
}

function globalHandle() {
	return (globalThis as DiagnosticsGlobal)[GLOBAL_KEY];
}

function importCount(): number {
	return (
		((globalThis as Record<symbol, unknown>)[IMPORT_COUNT] as
			| number
			| undefined) ?? 0
	);
}

let originalNodeEnv: string | undefined;

// NODE_ENV is typed read-only; assign through a mutable view of process.env.
function setNodeEnv(value: string | undefined): void {
	const env = process.env as Record<string, string | undefined>;
	if (value === undefined) {
		delete env.NODE_ENV;
	} else {
		env.NODE_ENV = value;
	}
}

beforeEach(() => {
	originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
	globalHandle()?.stop();
	delete process.env.NEXT_RUNTIME;
	delete process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS;
	delete process.env.EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS;
	delete (globalThis as Record<symbol, unknown>)[EMPTY_FLAG];
	setNodeEnv(originalNodeEnv);
});

describe("instrumentation register", () => {
	it("starts diagnostics on the nodejs runtime when enabled", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
		// Longest allowed interval keeps the real timer quiet during the test.
		process.env.EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS = "900000";
		const register = await freshRegister();
		await register();
		expect(globalHandle()?.running).toBe(true);
	});

	it("stays inert when the flag is unset", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		const register = await freshRegister();
		await register();
		expect(globalHandle()).toBeUndefined();
	});

	it("does not start on a non-nodejs runtime", async () => {
		process.env.NEXT_RUNTIME = "edge";
		process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
		const register = await freshRegister();
		await register();
		expect(globalHandle()).toBeUndefined();
	});
});

describe("sefarim corpus boot load", () => {
	it("loads the corpus during register on production nodejs", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		setNodeEnv("production");
		const before = importCount();
		const register = await freshRegister();
		await register();
		expect(importCount()).toBe(before + 1);
	});

	it("does not load the corpus outside production", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		setNodeEnv("test");
		const before = importCount();
		const register = await freshRegister();
		await register();
		expect(importCount()).toBe(before);
	});

	it("fails boot when the loaded corpus is empty", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		setNodeEnv("production");
		(globalThis as Record<symbol, unknown>)[EMPTY_FLAG] = true;
		const register = await freshRegister();
		await expect(register()).rejects.toThrow(
			"canonical sefarim corpus is empty",
		);
	});
});
