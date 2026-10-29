// Next.js incremental-cache handler that keeps every persisted cache key a
// legal filename on Windows. Next decodes the request pathname before
// building its route-cache storage key, so quoted Hebrew slugs such as
// `/929/1/רש"י` become filenames containing a literal `"` — rejected by NTFS
// with ENOENT / "Failed to update prerender cache" (issue #1999).
//
// This is a subclass of the default filesystem cache: persistence, tags,
// invalidation, seed promotion and prerender metadata stay upstream-owned.
// It only percent-encodes filename-unsafe bytes inside each storage-key
// segment, mirroring the encodeURIComponent convention `next build` already
// uses when it writes seeded prerender output (e.g.
// `.next/server/app/929/1/%D7%A8%D7%A9%22%D7%99.html`).
import FileSystemCacheModule from "next/dist/server/lib/incremental-cache/file-system-cache.js";

const FileSystemCache = FileSystemCacheModule.default;

// Filename characters safe on Windows, macOS and Linux alike. Anything else —
// non-ASCII letters, `"`, `*`, `?`, `|`, `<`, `>`, `%`, control characters —
// is percent-encoded byte-wise. `$` stays literal so the `/$` scope marker
// and `$d` dynamic-segment encodings keep their shape.
const SAFE_CHAR = /^[A-Za-z0-9$'()!_.~-]$/;

// Windows reserves these device names even with an extension (`CON.html` is
// still illegal), so a bare matching segment must be fully encoded.
const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const textEncoder = new TextEncoder();

const toPercent = (byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;

const encodeSegment = (segment) => {
	// `.`/`..` segments could escape the cache root through path.join.
	if (
		segment === "." ||
		segment === ".." ||
		WINDOWS_RESERVED_BASENAME.test(segment)
	) {
		return [...textEncoder.encode(segment)].map(toPercent).join("");
	}
	let encoded = "";
	for (const char of segment) {
		encoded += SAFE_CHAR.test(char)
			? char
			: [...textEncoder.encode(char)].map(toPercent).join("");
	}
	return encoded;
};

/**
 * Map a route-cache storage key to a filesystem-safe form by encoding every
 * unsafe segment. Keys that are already safe (ASCII slugs, sha256 digests,
 * the `/route-cache/<kind>/<sha>` prefix, the `/$` marker) pass through
 * unchanged, so existing entries resolve identically. Deterministic, so get,
 * set, seed-read and promotion all derive the same path from a key.
 */
export const filesystemSafeCacheKey = (key) =>
	key.split("/").map(encodeSegment).join("/");

export default class FilesystemSafeCacheHandler extends FileSystemCache {
	get(key, ctx) {
		return super.get(filesystemSafeCacheKey(key), ctx);
	}

	set(key, data, ctx) {
		return super.set(filesystemSafeCacheKey(key), data, ctx);
	}
}
