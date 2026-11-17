import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";

// Observe the naturally executed calls. Importing Appium here would move its
// lazy simulator initialization outside the measured preparation/session window.
export function spanRecorder(report, clock = () => performance.now()) {
	let nextId = 0;
	return (name) => {
		const id = ++nextId;
		const started = clock();
		report({ phase: "start", name, id, monotonicMs: started });
		return (success) => {
			const ended = clock();
			report({
				phase: "end",
				name,
				id,
				monotonicMs: ended,
				durationMs: ended - started,
				success,
			});
		};
	};
}

function finishSpan(end, success, threw, failure) {
	try {
		end(success);
	} catch (diagnosticError) {
		if (threw)
			throw new AggregateError(
				[failure, diagnosticError],
				"iOS discovery and diagnostic retention both failed.",
			);
		throw diagnosticError;
	}
}

export function traceAsyncCall(name, original, start) {
	return async function (...args) {
		const end = start(name);
		let success = false;
		let threw = false,
			failure;
		try {
			const result = await Reflect.apply(original, this, args);
			success = true;
			return result;
		} catch (error) {
			threw = true;
			failure = error;
			throw error;
		} finally {
			finishSpan(end, success, threw, failure);
		}
	};
}

export function traceMethods(target, names, start) {
	for (const name of names) {
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (typeof descriptor?.value !== "function")
			throw new Error(`Missing CoreSimulator diagnostic method: ${name}`);
		Object.defineProperty(target, name, {
			...descriptor,
			value: traceAsyncCall(`NativeSimctl.${name}`, descriptor.value, start),
		});
	}
}

export function traceSelector(original, start) {
	return function (command, ...args) {
		if (typeof command !== "string" || basename(command) !== "xcode-select") {
			return Reflect.apply(original, this, [command, ...args]);
		}
		const end = start("xcode-select.execFileSync");
		let success = false;
		let threw = false,
			failure;
		try {
			const result = Reflect.apply(original, this, [command, ...args]);
			success = true;
			return result;
		} catch (error) {
			threw = true;
			failure = error;
			throw error;
		} finally {
			finishSpan(end, success, threw, failure);
		}
	};
}

export function discoveryLoadHook({ helperUrl, report }) {
	return (url, context, nextLoad) => {
		const result = nextLoad(url, context);
		const native =
			/\/node_modules\/@appium\/coresim\/lib\/src\/native-simctl\.js$/.test(
				url,
			);
		const xcode = /\/node_modules\/appium-xcode\/build\/lib\/xcode\.js$/.test(
			url,
		);
		if (!native && !xcode) return result;
		if (result.format !== "module" || result.source == null)
			throw new Error("Unsupported iOS discovery module format.");
		const source =
			typeof result.source === "string"
				? result.source
				: Buffer.from(result.source).toString("utf8");
		const subject = native ? "coresim" : "appium-xcode";
		const supported = native
			? /export\s+class\s+NativeSimctl\b/.test(source)
			: /export\s+async\s+function\s+getVersion\s*\(/.test(source);
		if (!supported)
			throw new Error(`Unsupported ${subject} discovery diagnostic binding.`);
		report({
			phase: "instrumented",
			name: subject,
			sourceSha256: createHash("sha256").update(source).digest("hex"),
		});
		const suffix = native
			? "__tanahTraceMethods(NativeSimctl.prototype, ['getDevices', '_serviceContext', '_deviceSet'], __tanahDiscoveryStart);"
			: "getVersion = __tanahTraceAsyncCall('appium-xcode.getVersion', getVersion, __tanahDiscoveryStart);";
		return {
			...result,
			source: `${source}\nimport { traceMethods as __tanahTraceMethods, traceAsyncCall as __tanahTraceAsyncCall, discoveryStart as __tanahDiscoveryStart } from ${JSON.stringify(helperUrl)};\n${suffix}\n`,
		};
	};
}

function report(event) {
	// Fixed metadata only: no arguments, environment, device records or errors.
	appendFileSync(
		process.env.MOBILE_IOS_DISCOVERY_TRACE,
		`${JSON.stringify({
			kind: "ios-discovery-span/1",
			at: new Date().toISOString(),
			pid: process.pid,
			...event,
		})}\n`,
	);
}
export const discoveryStart = spanRecorder(report);

if (process.env.MOBILE_IOS_DISCOVERY_TRACE) {
	childProcess.execFileSync = traceSelector(
		childProcess.execFileSync,
		discoveryStart,
	);
	syncBuiltinESMExports();
	registerHooks({
		load: discoveryLoadHook({ helperUrl: import.meta.url, report }),
	});
	report({
		phase: "registered",
		name: "discovery-hooks",
		nodeVersion: process.version,
	});
}
