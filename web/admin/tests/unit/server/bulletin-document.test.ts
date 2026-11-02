import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const { queryOne } = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock("~/server/db", () => ({ queryOne }));

import {
	bulletinDocumentUrl,
	handleBulletinDocument,
} from "~/server/bulletin-document.server";

const pdf = Buffer.from("%PDF-1.7\npublic frozen bulletin\n%%EOF");
const digest = createHash("sha256").update(pdf).digest("hex");
const date = "2026-11-01";
const filename =
	"306_מלכים א יט - 306 - אליהו הנביא בורח מאיזבל, מבקש למות, התגלות ה' אליו.pdf";
const url = `https://admin.xn--febl3a.co.il/api/bulletin-documents/${date}/${digest}.pdf`;
beforeEach(() =>
	queryOne.mockReset().mockResolvedValue({ filename, pdf_data: pdf }),
);
describe("public content-addressed bulletin download", () => {
	it("serves exact frozen bytes and the complete UTF-8 legacy filename", async () => {
		expect(bulletinDocumentUrl(date, pdf)).toBe(url);
		const result = await handleBulletinDocument(new Request(url));
		expect(result?.status).toBe(200);
		expect(
			Buffer.from((await result?.arrayBuffer()) ?? new ArrayBuffer(0)),
		).toEqual(pdf);
		expect(result?.headers.get("Content-Type")).toBe("application/pdf");
		expect(result?.headers.get("Content-Length")).toBe(String(pdf.length));
		const disposition = result?.headers.get("Content-Disposition") ?? "";
		expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe(
			filename,
		);
		expect(disposition).toContain("%27");
		expect(result?.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(result?.headers.get("Content-Security-Policy")).toBe("sandbox");
		expect(result?.headers.get("ETag")).toBe(`"${digest}"`);
		expect(result?.headers.get("Cache-Control")).toContain("immutable");
		expect(queryOne).toHaveBeenCalledWith(
			expect.stringContaining("SHA2(pdf_data, 256) = ?"),
			[date, digest],
		);
	});
	it("supports HEAD without returning PDF bytes", async () => {
		const response = await handleBulletinDocument(
			new Request(url, { method: "HEAD" }),
		);
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("");
	});
	it("leaves other paths under the existing authentication gate", async () => {
		expect(
			await handleBulletinDocument(new Request("https://admin.test/bulletins")),
		).toBeNull();
		expect(queryOne).not.toHaveBeenCalled();
	});
	it.each([
		`${url}?override=file`,
		url.replace(date, "2026-02-30"),
		url.replace(digest, "invalid"),
		url.replace(digest, digest.toUpperCase()),
		url.replace(".pdf", ".html"),
		url.replace(date, "2026-1-1"),
	])(
		"does not query invalid or broadened download paths (%s)",
		async (invalid) => {
			expect((await handleBulletinDocument(new Request(invalid)))?.status).toBe(
				404,
			);
			expect(queryOne).not.toHaveBeenCalled();
		},
	);
	it("does not accept a mutation without authentication", async () => {
		const response = await handleBulletinDocument(
			new Request(url, { method: "POST" }),
		);
		expect(response?.status).toBe(405);
		expect(response?.headers.get("Allow")).toBe("GET, HEAD");
		expect(queryOne).not.toHaveBeenCalled();
	});
	it.each([
		null,
		{ filename, pdf_data: new Uint8Array(pdf) },
		{ filename, pdf_data: Buffer.from("html") },
		{ filename, pdf_data: Buffer.from("%PDF-other") },
		{ filename: "", pdf_data: pdf },
		{ filename: "../x.pdf", pdf_data: pdf },
		{ filename: "bad\r\nname.pdf", pdf_data: pdf },
		{ filename: "bad\\name.pdf", pdf_data: pdf },
		{ filename: "wrong.html", pdf_data: pdf },
		{ filename: `${"א".repeat(128)}.pdf`, pdf_data: pdf },
	])("never serves a missing, changed or unsafe artifact (%#)", async (row) => {
		queryOne.mockResolvedValue(row);
		expect((await handleBulletinDocument(new Request(url)))?.status).toBe(404);
	});
	it("validates dates before building a shareable link", () => {
		expect(() => bulletinDocumentUrl("2026-02-30", pdf)).toThrow();
	});
});
