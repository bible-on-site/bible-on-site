import { readFileSync } from "node:fs";
import { join } from "node:path";

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
			return portraits;
		}
		for (const [id, key] of Object.entries(snapshot)) {
			if (typeof key !== "string") continue;
			const keyId =
				caricatureKey.exec(key)?.[1] ?? revisedJpegKey.exec(key)?.[1];
			const authorId = Number(id);
			if (keyId === id && Number.isSafeInteger(authorId)) {
				portraits.set(authorId, key);
			}
		}
	} catch {
		// A missing or unreadable build artifact falls back to the existing JPEGs.
	}
	return portraits;
}

const snapshotKey = Symbol.for("bible-on-site.author-portrait-snapshot");
const store = globalThis as typeof globalThis & {
	[snapshotKey]?: ReadonlyMap<number, string>;
};

// Separate Next route bundles in the same process share this immutable build snapshot.
export function getAuthorPortraitKey(authorId: number): string | undefined {
	store[snapshotKey] ??= readPortraitSnapshot();
	return store[snapshotKey].get(authorId);
}
