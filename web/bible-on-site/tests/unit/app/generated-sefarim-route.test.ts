/** @jest-environment node */
jest.mock("node:fs/promises", () => ({
	readFile: jest.fn(),
}));

import { readFile } from "node:fs/promises";
import { brotliCompressSync } from "node:zlib";
import { GET } from "@/app/generated/sefarim/[file]/route";
import packageJson from "../../../package.json";

const mockRead = jest.mocked(readFile);
const payload = `${JSON.stringify({ name: "תהילים", perekFrom: 568 })}\n`;
const compressed = brotliCompressSync(payload);
const file = `568.${"a".repeat(64)}.json`;

const request = (name = file, acceptEncoding?: string, ifNoneMatch?: string) =>
	GET(
		new Request(`http://localhost/generated/sefarim/${name}`, {
			headers: {
				...(acceptEncoding ? { "accept-encoding": acceptEncoding } : {}),
				...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}),
			},
		}),
		{ params: Promise.resolve({ file: name }) },
	);

beforeEach(() => {
	mockRead.mockReset();
	mockRead.mockResolvedValue(compressed);
});

it("serves the compressed asset as Brotli when the client accepts it", async () => {
	const response = await request(file, "gzip, deflate, br, zstd");
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe(
		"application/json; charset=utf-8",
	);
	expect(response.headers.get("Content-Encoding")).toBe("br");
	expect(response.headers.get("Cache-Control")).toBe(
		"public, max-age=31536000, immutable",
	);
	expect(response.headers.get("Vary")).toBe("Accept-Encoding");
	expect(response.headers.get("ETag")).toBe(`"${"a".repeat(64)}"`);
	expect(response.headers.get("X-Website-Version")).toBe(packageJson.version);
	// The exact compressed bytes travel the network — the browser decodes them
	// transparently back to the content-hashed payload.
	expect(Buffer.from(await response.arrayBuffer())).toEqual(compressed);
});

it.each([undefined, "gzip, deflate", "br;q=0 gzip"])(
	"decodes the payload for clients without Brotli (Accept-Encoding: %s)",
	async (acceptEncoding) => {
		const response = await request(file, acceptEncoding);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Encoding")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(await response.text()).toBe(payload);
	},
);

it.each(["568.not-a-hash.json", "../568.json", "568.json", "x".repeat(200)])(
	"rejects a malformed asset name (%s)",
	async (name) => {
		const response = await request(name);
		expect(response.status).toBe(404);
		expect(mockRead).not.toHaveBeenCalled();
	},
);

it("answers 304 without a body for a matching conditional request", async () => {
	const response = await request(
		file,
		"gzip, br",
		`"${"a".repeat(64)}"`,
	);
	expect(response.status).toBe(304);
	expect(await response.text()).toBe("");
	expect(response.headers.get("Cache-Control")).toBe(
		"public, max-age=31536000, immutable",
	);
});

it("answers 404 for a well-formed name with no generated asset", async () => {
	mockRead.mockRejectedValue(
		Object.assign(new Error("missing"), { code: "ENOENT" }),
	);
	const response = await request();
	expect(response.status).toBe(404);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("answers 500 rather than masking an unexpected read failure", async () => {
	mockRead.mockRejectedValue(
		Object.assign(new Error("denied"), { code: "EACCES" }),
	);
	const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		const response = await request();
		expect(response.status).toBe(500);
		expect(diagnostic).toHaveBeenCalledWith("Reader book could not be read", {
			file,
			error: expect.any(Error),
		});
	} finally {
		diagnostic.mockRestore();
	}
});
