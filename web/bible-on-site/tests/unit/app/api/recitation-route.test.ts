/** @jest-environment node */
jest.mock("node:fs/promises", () => ({ readFile: jest.fn() }));
jest.mock("@/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn(() => ({
		pesukim: [{ segments: [{ type: "qri", value: "בראשית" }] }],
	})),
}));

import { readFile } from "node:fs/promises";
import { GET } from "@/app/api/recitation/[perekId]/route";

const originalEnv = process.env;
const manifest = {
	version: 1,
	audioSha256: "a".repeat(64),
	textSha256: "b".repeat(64),
	perekId: 1,
	durationMs: 5000,
	audioUrl:
		"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3",
	alignmentStatus: "ready",
	words: [{ pasuk: 1, segment: 1, text: "בראשית", startMs: 1000, endMs: 2000 }],
};
const request = (perekId = "1") =>
	GET(new Request(`http://localhost/api/recitation/${perekId}`), {
		params: Promise.resolve({ perekId }),
	});
beforeEach(() => {
	process.env = { ...originalEnv };
	delete process.env.S3_ENDPOINT;
	delete process.env.S3_BUCKET;
	delete process.env.S3_REGION;
	(readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));
});
afterEach(() => {
	process.env = originalEnv;
	jest.restoreAllMocks();
});

test("production uses S3 and local testing uses RustFS", async () => {
	expect((await (await request()).json()).audioUrl).toBe(manifest.audioUrl);
	process.env.S3_ENDPOINT = "http://localhost:4566/";
	process.env.S3_BUCKET = "bible-on-site-assets-test";
	expect((await (await request()).json()).audioUrl).toBe(
		"http://localhost:4566/bible-on-site-assets-test/recordings/1_record.mp3",
	);
});
test.each(["0", "930", "../1", "1.0", "01"])(
	"invalid chapter %s cannot read a file",
	async (id) => {
		expect((await request(id)).status).toBe(400);
		expect(readFile).not.toHaveBeenCalled();
	},
);
test("missing recordings return 404", async () => {
	(readFile as jest.Mock).mockRejectedValue(
		Object.assign(new Error("missing"), { code: "ENOENT" }),
	);
	expect((await request()).status).toBe(404);
});
test("incomplete or stale word maps cannot be served", async () => {
	jest.spyOn(console, "error").mockImplementation(() => {});
	(readFile as jest.Mock).mockResolvedValue(
		JSON.stringify({ ...manifest, words: [] }),
	);
	expect((await request()).status).toBe(500);
});
