import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import {
	discoveryLoadHook,
	spanRecorder,
	traceAsyncCall,
	traceMethods,
	traceSelector,
} from "./ios-discovery-trace.mjs";

const nativeUrl =
	"file:///test/node_modules/@appium/coresim/lib/src/native-simctl.js";
const xcodeUrl = "file:///test/node_modules/appium-xcode/build/lib/xcode.js";
const nativeSource = `export class NativeSimctl {
  async _serviceContext() { return this.context; }
  async _deviceSet() { return this._serviceContext(); }
  async getDevices() { return [await this._deviceSet()]; }
}`;
const xcodeSource = "export async function getVersion(parse) { return parse; }";

describe("iOS discovery tracing", () => {
	describe("with naturally executed asynchronous methods", () => {
		it("records nested spans with distinct identities and monotonic durations", async () => {
			const events = [];
			let now = 0;
			const start = spanRecorder(
				(event) => events.push(event),
				() => ++now,
			);
			const inner = traceAsyncCall("inner", async () => 42, start);
			const outer = traceAsyncCall("outer", inner, start);
			assert.equal(await outer(), 42);
			assert.deepEqual(
				events.map((e) => [e.phase, e.name, e.id]),
				[
					["start", "outer", 1],
					["start", "inner", 2],
					["end", "inner", 2],
					["end", "outer", 1],
				],
			);
			assert.deepEqual(
				events
					.filter((e) => e.phase === "end")
					.map((e) => [e.durationMs, e.success]),
				[
					[1, true],
					[3, true],
				],
			);
		});
		it("preserves the receiver, arguments, returned object and property flags", async () => {
			const value = {};
			const events = [];
			const target = {
				async read(a, b) {
					assert.equal(this, target);
					assert.deepEqual([a, b], [1, value]);
					return value;
				},
			};
			const flags = Object.getOwnPropertyDescriptor(target, "read");
			traceMethods(
				target,
				["read"],
				spanRecorder((e) => events.push(e)),
			);
			assert.equal(await target.read(1, value), value);
			const current = Object.getOwnPropertyDescriptor(target, "read");
			for (const flag of ["enumerable", "configurable", "writable"])
				assert.equal(current[flag], flags[flag]);
			assert.equal(events[1].name, "NativeSimctl.read");
			assert.equal(events[1].success, true);
		});
		it("preserves rejection identity without retaining its message or arguments", async () => {
			const error = new Error("private fixture message");
			const events = [];
			const wrapped = traceAsyncCall(
				"read",
				async () => {
					throw error;
				},
				spanRecorder((e) => events.push(e)),
			);
			await assert.rejects(
				wrapped("private fixture argument"),
				(e) => e === error,
			);
			assert.equal(events[1].success, false);
			assert(!JSON.stringify(events).includes("private fixture"));
		});
		it("rejects missing diagnostic method bindings", () => {
			assert.throws(
				() => traceMethods({}, ["getDevices"], () => {}),
				/Missing CoreSimulator/,
			);
		});
		it("retains both the operation failure and diagnostic failure", async () => {
			const original = new Error("operation");
			const diagnostic = new Error("retention");
			const wrapped = traceAsyncCall(
				"read",
				async () => {
					throw original;
				},
				() => () => {
					throw diagnostic;
				},
			);
			await assert.rejects(
				wrapped(),
				(e) =>
					e instanceof AggregateError &&
					e.errors[0] === original &&
					e.errors[1] === diagnostic,
			);
		});
		it("surfaces diagnostic retention failure after a successful call", async () => {
			const error = new Error("retention");
			await assert.rejects(
				traceAsyncCall(
					"read",
					async () => 1,
					() => () => {
						throw error;
					},
				)(),
				(e) => e === error,
			);
		});
	});

	describe("with synchronous developer-directory selection", () => {
		it("preserves command, options, receiver and result", () => {
			const events = [];
			const receiver = {};
			const args = ["-p"];
			const options = { timeout: 15000 };
			const result = { status: 0 };
			const fn = traceSelector(
				function (...values) {
					assert.equal(this, receiver);
					assert.deepEqual(values, ["/usr/bin/xcode-select", args, options]);
					return result;
				},
				spanRecorder((e) => events.push(e)),
			);
			assert.equal(
				fn.call(receiver, "/usr/bin/xcode-select", args, options),
				result,
			);
			assert.equal(events[1].name, "xcode-select.execFileSync");
			assert.equal(events[1].success, true);
		});
		it("leaves other commands unobserved", () => {
			const events = [];
			const fn = traceSelector(
				(command) => command,
				spanRecorder((e) => events.push(e)),
			);
			assert.equal(fn("xcrun"), "xcrun");
			assert.equal(fn(null), null);
			assert.equal(events.length, 0);
		});
		for (const result of ["/fixture/Xcode", Buffer.from("/fixture/Xcode")]) {
			it(`preserves successful ${typeof result} selector output`, () => {
				const events = [];
				const fn = traceSelector(
					() => result,
					spanRecorder((e) => events.push(e)),
				);
				assert.equal(fn("xcode-select"), result);
				assert.equal(events[1].success, true);
			});
		}
		it("preserves thrown selector failures", () => {
			const error = new Error("selector");
			const events = [];
			assert.throws(
				() =>
					traceSelector(
						() => {
							throw error;
						},
						spanRecorder((e) => events.push(e)),
					)("xcode-select"),
				(e) => e === error,
			);
			assert.equal(events[1].success, false);
		});
	});

	describe("with the Node synchronous load hook", () => {
		it("leaves unrelated modules and their loading untouched", () => {
			const result = { format: "module", source: "export const value=1;" };
			let calls = 0;
			const hook = discoveryLoadHook({
				helperUrl: import.meta.url,
				report: () => assert.fail("unrelated report"),
			});
			const context = {};
			assert.equal(
				hook("file:///test/other.mjs", context, (url, actual) => {
					calls++;
					assert.equal(actual, context);
					assert.equal(url, "file:///test/other.mjs");
					return result;
				}),
				result,
			);
			assert.equal(calls, 1);
		});
		for (const [url, source, subject] of [
			[nativeUrl, nativeSource, "coresim"],
			[xcodeUrl, xcodeSource, "appium-xcode"],
		]) {
			it(`appends ${subject} timing without rewriting the original source`, () => {
				const events = [];
				const hook = discoveryLoadHook({
					helperUrl: import.meta.url,
					report: (e) => events.push(e),
				});
				const result = hook(url, {}, () => ({
					format: "module",
					source: Buffer.from(source),
				}));
				assert(result.source.startsWith(source + "\n"));
				assert.equal(
					events[0].sourceSha256,
					createHash("sha256").update(source).digest("hex"),
				);
				assert.equal(events[0].name, subject);
			});
		}
		it("accepts string source and rejects unsupported formats or bindings", () => {
			const hook = discoveryLoadHook({
				helperUrl: import.meta.url,
				report: () => {},
			});
			assert(
				hook(xcodeUrl, {}, () => ({
					format: "module",
					source: xcodeSource,
				})).source.includes("__tanahTraceAsyncCall"),
			);
			for (const result of [
				{ format: "commonjs", source: xcodeSource },
				{ format: "module", source: null },
			])
				assert.throws(() => hook(xcodeUrl, {}, () => result), /module format/);
			for (const url of [nativeUrl, xcodeUrl])
				assert.throws(
					() =>
						hook(url, {}, () => ({
							format: "module",
							source: "export const changed = true;",
						})),
					/diagnostic binding/,
				);
		});
		it("executes the real preload and traces only naturally invoked fixture calls", (t) => {
			const root = mkdtempSync(join(tmpdir(), "ios-discovery-trace-"));
			t.after(() => rmSync(root, { recursive: true, force: true }));
			const put = (name, content) => {
				const file = join(root, name);
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, content);
				return file;
			};
			put("package.json", '{"type":"module"}');
			const native = put(
				"node_modules/@appium/coresim/lib/src/native-simctl.js",
				nativeSource,
			);
			put("node_modules/@appium/coresim/package.json", '{"type":"module"}');
			const xcode = put(
				"node_modules/appium-xcode/build/lib/xcode.js",
				xcodeSource,
			);
			put("node_modules/appium-xcode/package.json", '{"type":"module"}');
			const main = put(
				"main.mjs",
				`import assert from 'node:assert/strict';
        const {NativeSimctl} = await import(${JSON.stringify(pathToFileURL(native).href)});
        const {getVersion} = await import(${JSON.stringify(pathToFileURL(xcode).href)});
        const instance = new NativeSimctl(); instance.context = {privateFixture: true};
        assert.deepEqual(await instance.getDevices(), [{privateFixture: true}]);
        assert.equal(await getVersion(true), true); console.log('completed');`,
			);
			const output = join(root, "spans.jsonl");
			const stdout = execFileSync(
				process.execPath,
				[
					"--import",
					new URL("./ios-discovery-trace.mjs", import.meta.url).href,
					main,
				],
				{
					encoding: "utf8",
					windowsHide: true,
					env: { ...process.env, MOBILE_IOS_DISCOVERY_TRACE: output },
				},
			);
			assert.equal(stdout.trim(), "completed");
			const contents = readFileSync(output, "utf8");
			const events = contents
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.equal(events.filter((e) => e.phase === "instrumented").length, 2);
			assert.equal(events.filter((e) => e.phase === "start").length, 4);
			assert.equal(
				events.filter((e) => e.phase === "end" && e.success).length,
				4,
			);
			assert(
				events.every(
					(e) => e.kind === "ios-discovery-span/1" && Number.isInteger(e.pid),
				),
			);
			assert(!contents.includes("privateFixture"));
		});
	});
});
