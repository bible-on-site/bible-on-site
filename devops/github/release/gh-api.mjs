import { execFileSync } from "node:child_process";

/**
 * `gh api` transport failures that justify a bounded retry: dead TCP links,
 * DNS lookups, handshake resets, and upstream 5xx answers — the failure that
 * killed app CD run 37991296999 was a `dial tcp ... i/o timeout` on an
 * otherwise healthy runner. Deterministic API answers (4xx, validation
 * errors, malformed payloads) are never retried: they must fail fast instead
 * of being retried into a second write or misread as deploy consent.
 */
const transientPattern =
	/i\/o timeout|context deadline exceeded|connection reset|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|TLS handshake|HTTP 5\d\d|Bad Gateway|Service Unavailable|Gateway Timeout/i;

export function isTransientApiError(error) {
	const text = [error?.message, error?.stderr, error?.stdout]
		.filter((part) => typeof part === "string")
		.join("\n");
	return transientPattern.test(text);
}

/** Synchronous backoff; every caller here is execFileSync-based. */
const sleep = (ms) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export const apiAttempts = 3;

/**
 * Run `operation` with a bounded retry budget for transient GitHub API
 * failures. Non-transient errors and the final failure are rethrown
 * unchanged so callers keep their original error handling.
 */
export function withApiRetries(operation, attempts = apiAttempts, delayMs = 1500) {
	if (!Number.isSafeInteger(attempts) || attempts < 1)
		throw new Error("Retry attempts must be a positive integer");
	for (let attempt = 1; ; attempt++) {
		try {
			return operation(attempt);
		} catch (error) {
			if (!isTransientApiError(error) || attempt === attempts) throw error;
			console.error(
				`Transient GitHub API failure (attempt ${attempt}/${attempts}); retrying`,
			);
			sleep(delayMs * attempt);
		}
	}
}

const exec = (endpoint, body) =>
	JSON.parse(
		execFileSync(
			"gh",
			["api", endpoint, ...(body ? ["--method", "POST", "--input", "-"] : [])],
			{
				input: body ? JSON.stringify(body) : undefined,
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
			},
		),
	);

/**
 * GitHub REST call hardened for single-shot CI runners. `run` and `delayMs`
 * are injectable so tests can exercise the retry path without a network.
 */
export const ghApi = (endpoint, body, run = exec, delayMs = 1500) =>
	withApiRetries(() => run(endpoint, body), apiAttempts, delayMs);
