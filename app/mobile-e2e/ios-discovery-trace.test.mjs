import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
	nonFatalReporter,
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
		it("leaves every method untouched when a binding is missing or frozen", () => {
			for (const frozen of [false, true]) {
				const read = async () => 42;
				const target = { read };
				if (frozen) Object.freeze(target);
				const events = [];
				traceMethods(
					target,
					frozen ? ["read"] : ["read", "absent"],
					() => assert.fail("partial instrumentation"),
					(e) => events.push(e),
				);
				assert.equal(target.read, read);
				assert.deepEqual(events, [
					{ phase: "unsupported", name: "coresim", reason: "method-binding" },
				]);
			}
		});
		it("preserves operation failure identity when timing retention also fails", async () => {
			const original = new Error("operation");
			let warnings = 0;
			const wrapped = traceAsyncCall(
				"read",
				async () => {
					throw original;
				},
				spanRecorder(
					() => {
						throw new Error("retention");
					},
					undefined,
					() => warnings++,
				),
			);
			await assert.rejects(wrapped(), (e) => e === original);
			assert.equal(warnings, 1);
		});
		it("returns successful results when completion timing cannot be retained", async () => {
			let writes = 0,
				warnings = 0;
			const start = spanRecorder(
				() => {
					if (++writes > 1) throw new Error("retention");
				},
				undefined,
				() => warnings++,
			);
			assert.equal(await traceAsyncCall("read", async () => 1, start)(), 1);
			assert.equal(warnings, 1);
		});
		it("stops diagnostic writes after the first failure even with a closed warning pipe", () => {
			let writes = 0,
				warnings = 0;
			const observe = nonFatalReporter(
				() => {
					writes++;
					throw new Error("retention");
				},
				() => {
					warnings++;
					throw new Error("closed pipe");
				},
			);
			observe({});
			observe({});
			assert.equal(writes, 1);
			assert.equal(warnings, 1);
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
		it("accepts string source and retains unsupported modules unchanged", () => {
			const events = [];
			const hook = discoveryLoadHook({
				helperUrl: import.meta.url,
				report: (e) => events.push(e),
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
				assert.equal(
					hook(xcodeUrl, {}, () => result),
					result,
				);
			for (const url of [nativeUrl, xcodeUrl]) {
				const result = {
					format: "module",
					source: "export const changed = true;",
				};
				assert.equal(
					hook(url, {}, () => result),
					result,
				);
			}
			assert.equal(events.filter((e) => e.phase === "unsupported").length, 4);
		});
		it("preserves an original module-loading failure", () => {
			const error = new Error("original loader failure");
			const hook = discoveryLoadHook({
				helperUrl: import.meta.url,
				report: () => assert.fail("unexpected observation"),
			});
			assert.throws(
				() =>
					hook(nativeUrl, {}, () => {
						throw error;
					}),
				(e) => e === error,
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
			assert.equal(events.filter((e) => e.phase === "source-hooked").length, 2);
			assert.equal(events.filter((e) => e.phase === "ready").length, 2);
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
		it("runs the entry point when the actual preload cannot write its evidence", (t) => {
			const root = mkdtempSync(join(tmpdir(), "ios-discovery-write-failure-"));
			t.after(() => rmSync(root, { recursive: true, force: true }));
			const main = join(root, "main.mjs");
			writeFileSync(main, "console.log('completed');");
			const child = spawnSync(
				process.execPath,
				[
					"--import",
					new URL("./ios-discovery-trace.mjs", import.meta.url).href,
					main,
				],
				{
					encoding: "utf8",
					windowsHide: true,
					env: { ...process.env, MOBILE_IOS_DISCOVERY_TRACE: root },
				},
			);
			assert.equal(child.status, 0);
			assert.equal(child.stdout.trim(), "completed");
			assert.equal(
				child.stderr.trim(),
				"iOS discovery tracing unavailable; native outcome is unchanged.",
			);
		});
	});
});
