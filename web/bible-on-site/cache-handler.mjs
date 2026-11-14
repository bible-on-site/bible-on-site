// Keep Next's logical cache keys, metadata identity, tags and seed promotion
// unchanged. Only map filesystem paths that Windows cannot represent.
import FileSystemCacheModule from "next/dist/server/lib/incremental-cache/file-system-cache.js";

const FileSystemCache = [
	FileSystemCacheModule.default,
	FileSystemCacheModule.default?.default,
	FileSystemCacheModule.FileSystemCache,
	FileSystemCacheModule,
].find((candidate) => typeof candidate === "function");

// Unicode and interior spaces are valid filenames and are used by Next's
// existing build seeds. Encode "%" too so a literal "%22" slug cannot alias a quote.
const UNSAFE_CHAR = /["*:<>?\\|%]/;
// Next adds suffixes before getFilePath. Keep those suffixes literal so Next
// can still replace .html with .meta and .segments for ancillary files.
const WINDOWS_RESERVED_BASENAME =
	/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;
const textEncoder = new TextEncoder();
const toPercent = (byte) =>
	`%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
const encodeBytes = (text) =>
	[...textEncoder.encode(text)].map(toPercent).join("");

const encodeSegment = (segment, preservePercent = false) => {
	if (segment === "." || segment === "..") return encodeBytes(segment);
	const reserved = segment.match(WINDOWS_RESERVED_BASENAME)?.[0] ?? "";
	let encoded = "";
	let offset = 0;
	for (const char of segment) {
		const trailingDotOrSpace =
			offset + char.length === segment.length && (char === "." || char === " ");
		encoded +=
			offset < reserved.length ||
			char.codePointAt(0) < 32 ||
			(UNSAFE_CHAR.test(char) && !(preservePercent && char === "%")) ||
			trailingDotOrSpace
				? encodeBytes(char)
				: char;
		offset += char.length;
	}
	return encoded;
};

const encodePath = (key, preservePercent) =>
	key
		.split("/")
		.map((segment) => encodeSegment(segment, preservePercent))
		.join("/");

export const filesystemSafeCacheKey = (key) => encodePath(key, false);

export default class FilesystemSafeCacheHandler extends FileSystemCache {
	getFilePath(key, kind) {
		// Immutable build seeds already contain literal percent-encoded params.
		// Scoped mutable entries escape percent to keep quote/literal-percent
		// keys distinct; their logical identity stays owned by Next.
		const legacyResponseSeed =
			["APP_PAGE", "APP_ROUTE", "PAGES"].includes(kind) &&
			!key.startsWith("/route-cache/");
		return super.getFilePath(encodePath(key, legacyResponseSeed), kind);
	}
}
