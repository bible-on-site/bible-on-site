import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Reserves fresh evidence without resetting or adopting another run's trace. */
export function prepareDiscoveryEvidence(
	artifacts,
	{ makeId = randomUUID, reserve = writeFileSync } = {},
) {
	const file = `ios-discovery-spans-${makeId()}.jsonl`;
	const path = resolve(artifacts, file);
	try {
		reserve(path, "", { flag: "wx" });
		return { status: "ready", file, path };
	} catch {
		// Optional measurements must preserve the native test outcome. In particular,
		// a collision must never authorize appending to the pre-existing file.
		return { status: "unavailable", file: null, path: null };
	}
}
