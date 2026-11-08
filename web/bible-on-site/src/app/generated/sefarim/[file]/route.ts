import { readFile } from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import packageJson from "../../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Reader book assets (#3095). The catalog addresses the public URL
 * /generated/sefarim/{perekFrom}.{sha256-of-payload}.json; the prebuild keeps
 * the matching Brotli file under src/data/db/sefer-books. Serving the bytes
 * as Content-Encoding: br moves ~2-4 MB payloads on a few hundred KB — the
 * raw public copies were the heaviest, uncompressed fetch in the app and the
 * one that surfaced "לא ניתן לטעון את הספר." when the transfer failed.
 */
const BOOK_FILE = /^[1-9]\d*\.[a-f0-9]{64}\.json$/;
const BOOKS_DIR = path.resolve(process.cwd(), "src/data/db/sefer-books");
const CONTENT_TYPE = "application/json; charset=utf-8";
// Names are content-addressed: the bytes behind a URL can never change.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

function acceptsBrotli(request: Request): boolean {
	return (request.headers.get("accept-encoding") ?? "")
		.split(",")
		.some((token) => {
			const [encoding, ...params] = token.trim().split(";");
			if (encoding.trim() !== "br") return false;
			const q = params
				.map((param) => param.trim())
				.find((param) => param.startsWith("q="));
			return q === undefined || Number(q.slice(2)) > 0;
		});
}

export async function GET(
	request: Request,
	context: { params: Promise<{ file: string }> },
) {
	const { file } = await context.params;
	if (!BOOK_FILE.test(file)) {
		return Response.json(
			{ error: "Unknown reader book" },
			{ status: 404, headers: { "Cache-Control": "no-store" } },
		);
	}
	let compressed: Buffer;
	try {
		compressed = await readFile(path.join(BOOKS_DIR, `${file}.br`));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return Response.json(
				{ error: "Reader book unavailable" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}
		console.error("Reader book could not be read", { file, error });
		return Response.json(
			{ error: "Reader book unavailable" },
			{ status: 500, headers: { "Cache-Control": "no-store" } },
		);
	}
	const headers = {
		"Content-Type": CONTENT_TYPE,
		"Cache-Control": CACHE_CONTROL,
		Vary: "Accept-Encoding",
		ETag: `"${file.split(".")[1]}"`,
		"X-Website-Version": packageJson.version,
	};
	if (request.headers.get("if-none-match") === headers.ETag) {
		return new Response(null, { status: 304, headers });
	}
	if (acceptsBrotli(request)) {
		return new Response(new Uint8Array(compressed), {
			headers: { ...headers, "Content-Encoding": "br" },
		});
	}
	// Brotli is offered by every supported browser over HTTPS; decode on the
	// server only for agents outside that contract.
	return new Response(new Uint8Array(brotliDecompressSync(compressed)), {
		headers,
	});
}
