import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";

// Observe the naturally executed calls. Importing Appium here would move its
// lazy simulator initialization outside the measured preparation/session window.
export function nonFatalReporter(
	report,
	unavailable = () => {
		process.stderr.write(
			"iOS discovery tracing unavailable; native outcome is unchanged.\n",
		);
	},
) {
	let failed = false;
	return (event) => {
		if (failed) return;
		try {
			report(event);
		} catch {
			failed = true;
			try {
				unavailable();
			} catch {
				// A closed diagnostic pipe must also preserve the native outcome.
			}
		}
	};
}

export function spanRecorder(
	report,
	clock = () => performance.now(),
	unavailable,
) {
	const observe = nonFatalReporter(report, unavailable);
	let nextId = 0;
	return (name) => {
		const id = ++nextId;
		const started = clock();
		observe({ phase: "start", name, id, monotonicMs: started });
		return (success) => {
			const ended = clock();
			observe({
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

export function traceAsyncCall(name, original, start) {
	return async function (...args) {
		const end = start(name);
		let success = false;
		try {
			const result = await Reflect.apply(original, this, args);
			success = true;
			return result;
		} finally {
			end(success);
		}
	};
}

export function traceMethods(target, names, start, report = () => {}) {
	const observe = nonFatalReporter(report);
	const descriptors = names.map((name) =>
		Object.getOwnPropertyDescriptor(target, name),
	);
	if (
		descriptors.some(
			(descriptor) =>
				typeof descriptor?.value !== "function" ||
				(!descriptor.writable && !descriptor.configurable),
		)
	) {
		observe({
			phase: "unsupported",
			name: "coresim",
			reason: "method-binding",
		});
		return;
	}
	for (const [index, name] of names.entries()) {
		const descriptor = descriptors[index];
		Object.defineProperty(target, name, {
			...descriptor,
			value: traceAsyncCall(`NativeSimctl.${name}`, descriptor.value, start),
		});
	}
	observe({ phase: "ready", name: "coresim" });
}

export function traceSelector(original, start) {
	return function (command, ...args) {
		if (typeof command !== "string" || basename(command) !== "xcode-select") {
			return Reflect.apply(original, this, [command, ...args]);
		}
		const end = start("xcode-select.execFileSync");
		let success = false;
		try {
			const result = Reflect.apply(original, this, [command, ...args]);
			success = true;
			return result;
		} finally {
			end(success);
		}
	};
}

export function discoveryLoadHook({ helperUrl, report }) {
	const observe = nonFatalReporter(report);
	return (url, context, nextLoad) => {
		const result = nextLoad(url, context);
		const native = url.endsWith(
			"/node_modules/@appium/coresim/lib/src/native-simctl.js",
		);
		const xcode = url.endsWith("/node_modules/appium-xcode/build/lib/xcode.js");
		if (!native && !xcode) return result;
		const subject = native ? "coresim" : "appium-xcode";
		if (result.format !== "module" || result.source == null) {
			observe({ phase: "unsupported", name: subject, reason: "module-format" });
			return result;
		}
		const source =
			typeof result.source === "string"
				? result.source
				: Buffer.from(result.source).toString("utf8");
		const supported = native
			? /export\s+class\s+NativeSimctl\b/.test(source)
			: /export\s+async\s+function\s+getVersion\s*\(/.test(source);
		if (!supported) {
			observe({
				phase: "unsupported",
				name: subject,
				reason: "export-binding",
			});
			return result;
		}
		observe({
			phase: "source-hooked",
			name: subject,
			sourceSha256: createHash("sha256").update(source).digest("hex"),
		});
		const suffix = native
			? "__tanahTraceMethods(NativeSimctl.prototype, ['getDevices', '_serviceContext', '_deviceSet'], __tanahDiscoveryStart, __tanahDiscoveryReport);"
			: "getVersion = __tanahTraceAsyncCall('appium-xcode.getVersion', getVersion, __tanahDiscoveryStart); __tanahDiscoveryReport({phase: 'ready', name: 'appium-xcode'});";
		return {
			...result,
			source: `${source}\nimport { traceMethods as __tanahTraceMethods, traceAsyncCall as __tanahTraceAsyncCall, discoveryStart as __tanahDiscoveryStart, discoveryReport as __tanahDiscoveryReport } from ${JSON.stringify(helperUrl)};\n${suffix}\n`,
		};
	};
}

export const discoveryReport = nonFatalReporter((event) => {
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
});
export const discoveryStart = spanRecorder(discoveryReport);

if (process.env.MOBILE_IOS_DISCOVERY_TRACE) {
	childProcess.execFileSync = traceSelector(
		childProcess.execFileSync,
		discoveryStart,
	);
	syncBuiltinESMExports();
	registerHooks({
		load: discoveryLoadHook({
			helperUrl: import.meta.url,
			report: discoveryReport,
		}),
	});
	discoveryReport({
		phase: "registered",
		name: "discovery-hooks",
		nodeVersion: process.version,
	});
}
