import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetsUrl } from "../assets-url";

const caricatureKey =
	/^authors\/caricatures\/[A-Za-z0-9][A-Za-z0-9_-]*\/high-res\/([1-9]\d*)\.png$/;
const revisedJpegKey =
	/^authors\/high-res\/([1-9]\d*)\.jpg\?v=[0-9a-f]{32}(?:-[1-9]\d*)?$/;

function readPortraitSnapshot(): ReadonlyMap<number, string> {
	const portraits = new Map<number, string>();
	try {
		const snapshot: unknown = JSON.parse(
			readFileSync(
				join(process.cwd(), "public", "generated", "author-portraits.json"),
				"utf8",
			),
		);
		if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
			console.warn("Invalid author portrait snapshot. Using legacy JPEGs.");
			return portraits;
		}
		const entries = Object.entries(snapshot);
		for (const [id, key] of entries) {
			if (typeof key !== "string") continue;
			const keyId =
				caricatureKey.exec(key)?.[1] ?? revisedJpegKey.exec(key)?.[1];
			const authorId = Number(id);
			if (keyId === id && Number.isSafeInteger(authorId)) {
				portraits.set(authorId, key);
			}
		}
		if (entries.length !== portraits.size) {
			console.warn(
				"Ignoring invalid author portrait snapshot entries. Using legacy JPEGs for affected authors.",
			);
		}
	} catch (error) {
		console.warn(
			"Could not read the author portrait snapshot. Using legacy JPEGs.",
			error,
		);
	}
	return portraits;
}

interface PortraitSnapshot {
	keys: ReadonlyMap<number, string>;
	digest: string;
}

const snapshotKey = Symbol.for("bible-on-site.author-portrait-snapshot");
const store = globalThis as typeof globalThis & {
	[snapshotKey]?: PortraitSnapshot;
};

// Separate Next route bundles in the same process share this immutable build snapshot.
function getPortraitSnapshot(): PortraitSnapshot | undefined {
	if (
		process.env.NODE_ENV !== "production" ||
		process.env.S3_ENDPOINT ||
		(process.env.S3_BUCKET || "bible-on-site-assets") !== "bible-on-site-assets"
	) {
		return undefined;
	}

	if (!store[snapshotKey]) {
		const keys = readPortraitSnapshot();
		const sortedEntries = [...keys].sort(([a], [b]) => a - b);
		const hash = createHash("sha256");
		// Validated IDs and storage keys cannot contain the NUL separator.
		for (const [id, key] of sortedEntries) {
			hash.update(`${id}\0${key}\0`);
		}
		store[snapshotKey] = { keys, digest: hash.digest("hex") };
	}

	return store[snapshotKey];
}

export function getAuthorPortraitKey(authorId: number): string | undefined {
	return getPortraitSnapshot()?.keys.get(authorId);
}

/** Next's data cache can outlive a build. Scope cached DTOs with portrait URLs
 * to the selected snapshot and asset base, leaving their revalidation tags intact. */
export function authorPortraitCacheKey(baseKey: string): string {
	const digest = getPortraitSnapshot()?.digest ?? "legacy";
	return `${baseKey}:author-portraits:${digest}:${assetsUrl("")}`;
}
