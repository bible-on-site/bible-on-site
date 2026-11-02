import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	saveLighthouseReport,
	writePerformanceIndex,
} from "./performance-report.mjs";

export function parseOptions(args) {
	const { values } = parseArgs({
		args,
		options: {
			url: { type: "string", multiple: true },
			device: { type: "string", default: "both" },
			runs: { type: "string", default: "3" },
			output: { type: "string" },
			"skip-field": { type: "boolean", default: false },
			"save-assets": { type: "boolean", default: false },
			channel: { type: "string" },
			help: { type: "boolean", default: false },
		},
	});
	if (values.help) return { help: true };
	if (!["mobile", "desktop", "both"].includes(values.device))
		throw new Error("--device must be mobile, desktop or both");
	const runs = Number(values.runs);
	if (!Number.isInteger(runs) || runs < 1 || runs > 10)
		throw new Error("--runs must be an integer from 1 to 10");
	const urls = (
		values.url || [
			"https://xn--febl3a.co.il/",
			"https://xn--febl3a.co.il/929/686",
		]
	).map((input) => {
		const url = new URL(input);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password
		)
			throw new Error(
				"--url requires an HTTP(S) URL without embedded credentials",
			);
		url.hash = "";
		return url.href;
	});
	return {
		urls: [...new Set(urls)],
		devices: values.device === "both" ? ["mobile", "desktop"] : [values.device],
		runs,
		output: resolve(
			values.output ||
				`.playwright-report/production/${new Date().toISOString().replace(/[:.]/g, "-")}`,
		),
		field: !values["skip-field"],
		saveAssets: values["save-assets"],
		channel: values.channel,
	};
}

export async function collectCrux(
	url,
	device,
	scope,
	{ apiKey, fetcher = fetch } = {},
) {
	const base = { url, device, scope, source: "CrUX API" };
	if (!apiKey)
		return {
			...base,
			status: "unavailable",
			reason: "CRUX_API_KEY is not set; real-user data was not queried",
		};
	try {
		const response = await fetcher(
			"https://chromeuxreport.googleapis.com/v1/records:queryRecord",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Goog-Api-Key": apiKey,
				},
				body: JSON.stringify({
					[scope]: scope === "origin" ? new URL(url).origin : url,
					formFactor: device === "mobile" ? "PHONE" : "DESKTOP",
					metrics: [
						"largest_contentful_paint",
						"interaction_to_next_paint",
						"cumulative_layout_shift",
						"first_contentful_paint",
						"experimental_time_to_first_byte",
					],
				}),
				signal: AbortSignal.timeout(30_000),
			},
		);
		if (!response.ok)
			return {
				...base,
				status: "unavailable",
				reason:
					response.status === 404
						? "No CrUX record for this page/origin and device"
						: `CrUX returned HTTP ${response.status}`,
			};
		const data = await response.json();
		if (!data.record?.metrics)
			return {
				...base,
				status: "unavailable",
				reason: "CrUX returned no metric record",
			};
		return { ...base, status: "available", record: data.record };
	} catch (error) {
		// Do not serialize request headers or credential-bearing fetch errors.
		return {
			...base,
			status: "unavailable",
			reason: `CrUX request failed (${error.name})`,
		};
	}
}

export async function collectFlaggedAssets(
	directory,
	reports,
	fetcher = fetch,
) {
	const urls = new Set();
	for (const report of reports) {
		for (const audit of report.opportunities) {
			for (const evidence of audit.evidence) {
				if (!evidence.url) continue;
				const url = new URL(evidence.url, report.url);
				if (
					url.origin === new URL(report.url).origin &&
					/^\/_next\/static\/.*\.(css|js)$/.test(url.pathname)
				)
					urls.add(url.href);
			}
		}
	}
	const assets = [];
	mkdirSync(join(directory, "assets"), { recursive: true });
	for (const url of urls) {
		try {
			const response = await fetcher(url, {
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) {
				assets.push({ url, reason: `HTTP ${response.status}` });
				continue;
			}
			const bytes = Buffer.from(await response.arrayBuffer());
			const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
			const extension = new URL(url).pathname.endsWith(".css") ? "css" : "js";
			const file = `assets/${hash}.${extension}`;
			writeFileSync(join(directory, file), bytes);
			assets.push({
				url,
				file,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		} catch (error) {
			assets.push({ url, reason: `Download failed (${error.name})` });
		}
	}
	return assets;
}

export async function collectProductionPerformance(options) {
	// Lazy imports keep --help and parser/field-data tests independent of Chrome.
	const [
		{ chromium },
		{ default: getPort },
		{ default: lighthouse, desktopConfig },
	] = await Promise.all([
		import("@playwright/test"),
		import("get-port"),
		import("lighthouse"),
	]);
	const reports = [];
	const field = [];
	let failed = false;
	for (const url of options.urls) {
		for (const device of options.devices) {
			if (options.field) {
				field.push(
					await collectCrux(url, device, "url", {
						apiKey: process.env.CRUX_API_KEY,
					}),
				);
				const origin = new URL(url).origin;
				if (
					!field.some(
						(entry) =>
							entry.scope === "origin" &&
							entry.url === origin &&
							entry.device === device,
					)
				) {
					field.push(
						await collectCrux(origin, device, "origin", {
							apiKey: process.env.CRUX_API_KEY,
						}),
					);
				}
			}
			for (let run = 1; run <= options.runs; run++) {
				console.log(`Auditing ${url} (${device}, run ${run}/${options.runs})`);
				const port = await getPort();
				// Fresh browser profile per sample, no warm-up visit. Lighthouse resets
				// storage normally; repeat samples must not inherit another device's cache.
				const browser = await chromium.launchPersistentContext("", {
					headless: true,
					channel: options.channel,
					args: [`--remote-debugging-port=${port}`],
				});
				try {
					const result = await lighthouse(
						url,
						{
							port,
							output: ["json", "html"],
							logLevel: "error",
							onlyCategories: [
								"performance",
								"accessibility",
								"best-practices",
								"seo",
							],
						},
						device === "desktop" ? desktopConfig : undefined,
					);
					if (!result?.lhr) throw new Error("Lighthouse returned no report");
					const report = saveLighthouseReport(
						options.output,
						result.lhr,
						{ device, run, environment: "production-lab" },
						result.report[1],
					);
					reports.push(report);
					failed ||= Boolean(report.runtimeError);
				} finally {
					await browser.close();
					// Keep completed evidence even if a later sample fails.
					writePerformanceIndex(options.output, reports, field);
				}
			}
		}
	}
	const assets = options.saveAssets
		? await collectFlaggedAssets(options.output, reports)
		: [];
	writePerformanceIndex(options.output, reports, field, assets);
	console.log(`Saved ${reports.length} audits to ${options.output}`);
	return { reports, field, failed };
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.help) {
		console.log(`Collect production performance without a local build or database.

Usage: bun run perf:production [options]
  --url URL          Repeat for each page (default: production home and /929/686)
  --device DEVICE    mobile, desktop or both (default: both)
  --runs N           Fresh-profile Lighthouse samples per page/device (default: 3)
  --output DIR       Report folder (default: timestamped .playwright-report/production)
  --channel CHANNEL  Installed browser, e.g. chrome (default: Playwright Chromium)
  --skip-field       Skip optional real-user CrUX queries
  --save-assets      Save flagged first-party CSS/JS with URL/checksum metadata

Set CRUX_API_KEY in the environment to include CrUX page and origin p75 data.
Missing credentials/data are recorded as unavailable; lab TBT is never called INP.
Output: raw Lighthouse JSON/HTML per sample, summary.json and summary.md.`);
		return;
	}
	const result = await collectProductionPerformance(options);
	if (result.failed) process.exitCode = 1;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
