import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { request as githubRequest } from "./deployment-state.mjs";

export function readIpa(ipa, expectedVersion) {
	const metadata = JSON.parse(
		execFileSync(
			process.platform === "win32" ? "python" : "python3",
			[
				"-c",
				`
import json, plistlib, re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    names = [name for name in archive.namelist() if re.fullmatch(r'Payload/[^/]+\\.app/Info\\.plist', name)]
    if len(names) != 1: raise ValueError('IPA must contain exactly one main app Info.plist')
    info = plistlib.loads(archive.read(names[0]))
    print(json.dumps({ 'bundle': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'], 'number': info['CFBundleVersion'] }))
`,
				ipa,
			],
			{ encoding: "utf8" },
		),
	);
	if (
		metadata.bundle !== "com.tanah.daily929" ||
		!/^\d+\.\d+\.\d+$/.test(metadata.version) ||
		!/^\d+$/.test(metadata.number) ||
		metadata.version !== expectedVersion
	)
		throw new Error("IPA identity/version does not match the guarded release");
	return metadata;
}

export function apiToken(credentials, now = Math.floor(Date.now() / 1000)) {
	if (!credentials.key_id || !credentials.issuer_id || !credentials.key)
		throw new Error("App Store Connect API credentials are incomplete");
	const key = createPrivateKey(credentials.key);
	if (
		key.asymmetricKeyType !== "ec" ||
		key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
	)
		throw new Error("App Store Connect requires a P-256 signing key");
	const encode = (value) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const message = `${encode({ alg: "ES256", kid: credentials.key_id, typ: "JWT" })}.${encode({ iss: credentials.issuer_id, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
	return `${message}.${sign("sha256", Buffer.from(message), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

// Reads that may legitimately be retried: throttling, gateway/server faults
// and request timeouts. 4xx authorization/lookup answers and malformed or
// truncated payloads are permanent — retrying them hides the real cause.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Network and deadline failures fetch surfaces without an HTTP status. */
function isTransientRead(error) {
	return (
		error?.name === "TimeoutError" ||
		error?.name === "AbortError" ||
		error instanceof TypeError
	);
}

function retryAfterMs(response, now) {
	const header = response.headers?.get?.("retry-after");
	if (header == null) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(header);
	return Number.isNaN(date) ? null : Math.max(0, date - now());
}

/**
 * Read-only App Store Connect GET with a bounded retry budget (#2842): a
 * single 15 s timeout used to kill the whole pack publish mid-planning.
 * Transient timeout/network failures and throttled/server answers retry with
 * exponential backoff + jitter (Retry-After honored), capped by `retries` and
 * an overall `budgetMs`; permanent 4xx/malformed answers stay actionable and
 * are never retried. `sleep`/`now`/`random` are injected by tests.
 */
export function appleReader(
	credentials,
	fetcher,
	{
		retries = 3,
		timeoutMs = 15000,
		budgetMs = 120000,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now = () => Date.now(),
		random = Math.random,
		report = console.error,
	} = {},
) {
	if (!Number.isSafeInteger(retries) || retries < 1)
		throw new Error("Apple read retries must be a positive integer");
	return async (path, parameters) => {
		const url = new URL(`https://api.appstoreconnect.apple.com/v1/${path}`);
		url.search = new URLSearchParams(parameters).toString();
		const deadline = now() + budgetMs;
		let failure = null;
		for (let attempt = 1; ; attempt++) {
			// The per-request deadline is unchanged — retries wrap whole
			// requests, they never stretch a single one.
			const remaining = Math.max(1, Math.min(timeoutMs, deadline - now()));
			let waitMs = null;
			try {
				const response = await fetcher(url, {
					headers: { Authorization: `Bearer ${apiToken(credentials)}` },
					redirect: "error",
					signal: AbortSignal.timeout(remaining),
				});
				if (response.ok) {
					const result = await response.json();
					if (!Array.isArray(result.data) || result.links?.next)
						throw new Error(
							"App Store Connect returned an incomplete build lookup",
						);
					return result;
				}
				if (!RETRYABLE_STATUS.has(response.status))
					throw new Error(
						`App Store Connect lookup failed: HTTP ${response.status}`,
					);
				failure = new Error(
					`App Store Connect lookup failed: HTTP ${response.status}`,
				);
				waitMs = retryAfterMs(response, now);
			} catch (error) {
				if (!isTransientRead(error)) throw error;
				failure = error;
			}
			if (attempt >= retries || deadline - now() <= 0) break;
			// A server-directed Retry-After is authoritative: honor it fully up
			// to the remaining budget instead of retrying inside the throttle
			// window. Self-chosen exponential backoff stays capped at 30 s.
			const backoff = Math.min(
				waitMs ?? Math.min(1000 * 2 ** (attempt - 1) + random() * 250, 30000),
				Math.max(0, deadline - now()),
			);
			report(
				JSON.stringify({
					phase: "apple-read-retry",
					path,
					attempt: attempt + 1,
					failure: failure.message,
				}),
			);
			if (backoff > 0) await sleep(backoff);
		}
		throw failure;
	};
}

export async function findApp(metadata, read) {
	const apps = (
		await read("apps", { "filter[bundleId]": metadata.bundle, limit: "200" })
	).data;
	if (
		apps.length !== 1 ||
		apps[0].attributes?.bundleId !== metadata.bundle ||
		typeof apps[0].id !== "string" ||
		!apps[0].id
	)
		throw new Error("App Store Connect app identity is ambiguous");
	return apps[0];
}

export async function findBuild(metadata, credentials, fetcher = fetch) {
	const read = appleReader(credentials, fetcher);
	const expectedApp = await findApp(metadata, read);
	const result = await read("builds", {
		"filter[app]": expectedApp.id,
		"filter[version]": metadata.number,
		"filter[preReleaseVersion.version]": metadata.version,
		"filter[preReleaseVersion.platform]": "IOS",
		include: "app,preReleaseVersion",
		limit: "200",
	});
	if (result.data.length > 1)
		throw new Error("App Store Connect build identity is ambiguous");
	if (result.data.length === 0) return null;
	const build = result.data[0];
	const version = result.included?.find(
		(item) =>
			item.type === "preReleaseVersions" &&
			item.id === build.relationships?.preReleaseVersion?.data?.id,
	);
	const app = result.included?.find(
		(item) =>
			item.type === "apps" && item.id === build.relationships?.app?.data?.id,
	);
	if (
		!build.id ||
		app?.id !== expectedApp.id ||
		app.attributes.bundleId !== metadata.bundle ||
		build.attributes?.version !== metadata.number ||
		build.attributes.expired !== false ||
		version?.attributes?.version !== metadata.version ||
		version.attributes.platform !== "IOS" ||
		!["PROCESSING", "VALID", "INVALID", "FAILED"].includes(
			build.attributes.processingState,
		)
	)
		throw new Error("App Store Connect returned a mismatched or invalid build");
	return { id: build.id, state: build.attributes.processingState, ...metadata };
}

/** Upload diagnostics remain read-only and never authorize another upload. */
export async function findBuildUploads(metadata, credentials, fetcher = fetch) {
	const read = appleReader(credentials, fetcher);
	const app = await findApp(metadata, read);
	const result = await read(`apps/${encodeURIComponent(app.id)}/buildUploads`, {
		"filter[cfBundleShortVersionString]": metadata.version,
		"filter[cfBundleVersion]": metadata.number,
		"filter[platform]": "IOS",
		"fields[buildUploads]":
			"cfBundleShortVersionString,cfBundleVersion,platform,state",
		limit: "200",
	});
	return result.data.map((upload) => {
		const attributes = upload.attributes;
		if (
			!upload.id ||
			upload.type !== "buildUploads" ||
			attributes?.cfBundleShortVersionString !== metadata.version ||
			attributes.cfBundleVersion !== metadata.number ||
			attributes.platform !== "IOS" ||
			!["AWAITING_UPLOAD", "PROCESSING", "FAILED", "COMPLETE"].includes(
				attributes.state?.state,
			)
		)
			throw new Error(
				"App Store Connect returned mismatched upload diagnostics",
			);
		return {
			id: upload.id,
			state: attributes.state.state,
			errors: uploadDetails(attributes.state.errors),
			warnings: uploadDetails(attributes.state.warnings),
			...metadata,
		};
	});
}

function uploadDetails(details) {
	if (details == null) return [];
	if (!Array.isArray(details))
		throw new Error("App Store Connect returned malformed upload details");
	return details.map(({ code, description }) => ({ code, description }));
}

/** Definitive Apple validation failures cannot become a successful upload step. */
export function checkUploadResult(exitCode, log, report = console.log) {
	if (!/^\d+$/.test(String(exitCode)))
		throw new Error("Uploader exit status is missing or invalid");
	const rejection = log
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.split(/\r?\n/)
		.find(
			(line) =>
				// A duplicate may be the accepted result of an earlier interrupted
				// upload. Only the exact-build API check may recover that case.
				!/redundant binary upload|already (?:been )?uploaded/i.test(line) &&
				(/\bValidation failed(?:\s+\(\d+\))?\s+(?!["';),{])[A-Za-z]/i.test(
					line,
				) ||
					/\bERROR\s*:?\s*ITMS-\d+\b/i.test(line) ||
					(/STATE_ERROR\.VALIDATION_ERROR/.test(line) &&
						/\b(?:detail|NSLocalizedFailureReason)\s*[=:]/.test(line))),
		);
	if (rejection)
		throw new Error(`Apple rejected the upload: ${rejection.trim()}`);
	if (Number(exitCode) !== 0)
		report(
			"::warning::Uploader failed without a definitive Apple validation rejection; verifying the exact build without uploading again",
		);
}

export function previousDelivery(
	{ repo, ref, version, deploymentId },
	api = githubRequest,
) {
	for (let page = 1; ; page++) {
		const deployments = api(
			`repos/${repo}/deployments?sha=${ref}&environment=app-ios&task=deploy:release&per_page=100&page=${page}`,
		);
		if (!Array.isArray(deployments))
			throw new Error("Invalid deployment history");
		if (
			deployments.some(
				(item) =>
					String(item.id) !== String(deploymentId) &&
					item.payload?.release_key === `app-ios-v${version}`,
			)
		)
			return true;
		if (deployments.length < 100) return false;
	}
}

/** A missing build permits one upload only on the first recorded delivery. */
export async function checkBuild({
	lookup,
	phase,
	previous = false,
	// Extension-bearing builds can take longer than ten minutes to appear.
	attempts = 60,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	report = console.log,
}) {
	if (!["preflight", "postflight", "inspect"].includes(phase))
		throw new Error("Unknown TestFlight check phase");
	for (let attempt = 0; attempt < attempts; attempt++) {
		const build = await lookup();
		report(JSON.stringify({ phase, attempt: attempt + 1, build }));
		if (phase === "inspect") return { upload: false, build };
		if (build?.state === "VALID") return { upload: false, build };
		if (build && build.state !== "PROCESSING")
			throw new Error(`Apple rejected the exact build: ${build.state}`);
		if (!build && phase === "preflight" && !previous)
			return { upload: true, build: null };
		if (attempt + 1 < attempts) await sleep(30000);
	}
	throw new Error(
		"Apple has not confirmed the exact build as VALID; do not repeat an ambiguous upload",
	);
}

async function main() {
	const phase = process.argv[2];
	if (phase === "upload-result") {
		checkUploadResult(
			process.argv[4],
			readFileSync(process.argv[3], "utf8"),
		);
		return;
	}
	const metadata = readIpa(process.env.IPA_FILE, process.env.MODULE_VERSION);
	const credentials = process.env.API_KEY_PATH
		? JSON.parse(readFileSync(process.env.API_KEY_PATH, "utf8"))
		: {
				key_id: process.env.API_KEY_ID,
				issuer_id: process.env.API_ISSUER_ID,
				key: Buffer.from(process.env.API_KEY_BASE64 ?? "", "base64").toString(
					"utf8",
				),
			};
	const previous =
		phase === "preflight" &&
		previousDelivery({
			repo: process.env.GITHUB_REPOSITORY,
			ref: process.env.ARTIFACT_REF,
			version: metadata.version,
			deploymentId: process.env.DEPLOYMENT_ID,
		});
	const reportUploads = async () =>
		console.log(
			JSON.stringify({
				phase: "upload-inspect",
				uploads: await findBuildUploads(metadata, credentials),
			}),
		);
	let result;
	try {
		result = await checkBuild({
			phase,
			previous,
			lookup: () => findBuild(metadata, credentials),
		});
	} catch (error) {
		try {
			await reportUploads();
		} catch (diagnosticError) {
			console.error(
				`Upload diagnostics unavailable: ${diagnosticError.message}`,
			);
		}
		throw error;
	}
	if (phase === "inspect") await reportUploads();
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`upload=${result.upload}\napp_identifier=${metadata.bundle}\napp_version=${metadata.version}\nbuild_number=${metadata.number}\n`,
		);
	if (phase === "postflight" && process.env.UPLOAD_EXIT_CODE !== "0")
		console.log(
			"::warning::Uploader failed, but Apple's API confirms this exact build is VALID; resuming without another upload",
		);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
)
	await main();
