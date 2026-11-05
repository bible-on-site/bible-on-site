import { createHash } from "node:crypto";
import { recitationPackage } from "@/lib/recitation-package";

const responseKey = Symbol.for("bible-on-site.recitation-response");
const server = globalThis as typeof globalThis & {
	[responseKey]?: { configuration: string; body: string; etag: string };
};

/** Share readiness's prepared response across independently loaded route bundles. */
export function recitationResponse() {
	const configuration = JSON.stringify([
		process.env.ASSETS_BASE_URL,
		process.env.S3_ENDPOINT,
		process.env.S3_BUCKET,
		process.env.S3_REGION,
	]);
	const cached = server[responseKey];
	if (cached?.configuration === configuration) return cached;

	// Publish only the complete, validated body. Failed validation must remain
	// retryable, and changed storage settings must rebuild the public URLs.
	const body = JSON.stringify(recitationPackage());
	const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
	const response = { configuration, body, etag };
	// nosemgrep: javascript.lang.correctness.no-stringify-keys -- the key is a fixed Symbol; serialized JSON is only the cached value.
	server[responseKey] = response;
	return response;
}
