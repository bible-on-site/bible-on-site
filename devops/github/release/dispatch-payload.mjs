import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Keep immutable release metadata while fitting GitHub's dispatch envelope. */
export function compactDispatchPayload(payload) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		throw new Error("Dispatch payload must be an object");
	if (Object.keys(payload).length <= 10) return { ...payload };
	if (Object.hasOwn(payload, "artifacts"))
		throw new Error("Dispatch artifact envelope already exists");
	const entries = Object.entries(payload);
	const artifacts = Object.fromEntries(
		entries.filter(([key]) => key.endsWith("_artifact_name")),
	);
	const compact = {
		...Object.fromEntries(
			entries.filter(([key]) => !key.endsWith("_artifact_name")),
		),
		artifacts,
	};
	if (Object.keys(compact).length > 10)
		throw new Error("Dispatch payload still exceeds ten top-level properties");
	return compact;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const payload = compactDispatchPayload(JSON.parse(process.env.RELEASE_PAYLOAD));
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`client_payload=${JSON.stringify(payload)}\n`,
	);
}
