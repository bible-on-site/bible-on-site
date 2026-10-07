/** @jest-environment node */
jest.mock("node:fs", () => ({ readFileSync: jest.fn() }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const environment = process.env;
const cache = Symbol.for("bible-on-site.canonical-sefarim");
const server = globalThis as typeof globalThis & { [cache]?: unknown };
const bytes = '[{"name":"בראשית","precision":0.9523809523809523}]';

function load() {
	let data: unknown[] = [];
	jest.isolateModules(() => {
		data = jest.requireActual("../../../src/data/db/sefarim").sefarim;
	});
	return data;
}

beforeEach(() => {
	process.env = { ...environment, NODE_ENV: "production" };
	delete process.env.IS_TEST_ENV;
	delete server[cache];
	(readFileSync as jest.Mock).mockReturnValue(bytes);
});

afterEach(() => {
	process.env = environment;
	delete server[cache];
});

test("production parses the original traced bytes without bundler rounding", () => {
	expect(load()).toEqual(JSON.parse(bytes));
	expect(readFileSync).toHaveBeenCalledWith(
		resolve(process.cwd(), "src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"),
		"utf8",
	);
});

test("separate server module contexts share the parsed canonical objects", () => {
	const first = load();
	const second = load();
	expect(second[0]).toBe(first[0]);
	expect(readFileSync).toHaveBeenCalledTimes(1);
});

test.each([new Error("Canonical file missing"), new SyntaxError("Invalid JSON")])(
	"failed canonical loads cannot leave a partial process cache: %s",
	(error) => {
		if (error instanceof SyntaxError)
			(readFileSync as jest.Mock).mockReturnValueOnce("{");
		else (readFileSync as jest.Mock).mockImplementationOnce(() => { throw error; });
		expect(load).toThrow();
		expect(load()).toEqual(JSON.parse(bytes));
		expect(readFileSync).toHaveBeenCalledTimes(2);
	},
);
