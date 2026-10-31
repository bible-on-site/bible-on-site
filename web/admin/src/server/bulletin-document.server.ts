import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { validateBulletinDate } from "~/lib/daily-bulletin";

const PREFIX = "/api/bulletin-documents/";
const ORIGIN = "https://admin.xn--febl3a.co.il";

/** A content-addressed link to the public bulletin, with no subscriber data. */
export function bulletinDocumentUrl(date: string, pdf: Uint8Array): string {
	validateBulletinDate(date);
	return `${ORIGIN}${PREFIX}${date}/${createHash("sha256").update(pdf).digest("hex")}.pdf`;
}

/** This is the only anonymous admin endpoint; it cannot invoke any admin action. */
export async function handleBulletinDocument(
	request: Request,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(PREFIX)) return null;
	const match =
		/^\/api\/bulletin-documents\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{64})\.pdf$/.exec(
			url.pathname,
		);
	const missing = () => new Response("Not found", { status: 404 });
	if (!match || url.search) return missing();
	try {
		validateBulletinDate(match[1]);
	} catch {
		return missing();
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", {
			status: 405,
			headers: { Allow: "GET, HEAD" },
		});
	}
	const { queryOne } = await import("./db");
	const row = await queryOne<{ filename: string; pdf_data: Buffer }>(
		"SELECT filename, pdf_data FROM tanah_daily_bulletin WHERE bulletin_date = ? AND SHA2(pdf_data, 256) = ?",
		[match[1], match[2]],
	);
	if (
		!row ||
		!Buffer.isBuffer(row.pdf_data) ||
		row.pdf_data.subarray(0, 5).toString() !== "%PDF-" ||
		createHash("sha256").update(row.pdf_data).digest("hex") !== match[2] ||
		!row.filename ||
		Buffer.byteLength(row.filename) > 255 ||
		/[/\\]/.test(row.filename) ||
		[...row.filename].some(
			(c) =>
				c.charCodeAt(0) < 32 ||
				(c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
		) ||
		!row.filename.endsWith(".pdf")
	)
		return missing();
	const encoded = encodeURIComponent(row.filename).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return new Response(
		request.method === "HEAD" ? null : new Uint8Array(row.pdf_data),
		{
			headers: {
				"Content-Type": "application/pdf",
				"Content-Length": String(row.pdf_data.length),
				"Content-Disposition": `attachment; filename="bulletin-${match[1]}.pdf"; filename*=UTF-8''${encoded}`,
				"Cache-Control": "public, max-age=31536000, immutable",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "sandbox",
				ETag: `"${match[2]}"`,
			},
		},
	);
}
