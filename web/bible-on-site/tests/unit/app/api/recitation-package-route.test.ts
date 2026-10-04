/** @jest-environment node */
jest.mock("@/data/perek-dto", () => ({ getPerekByPerekId: jest.fn() }));

import { createHash } from "node:crypto";
import { GET } from "@/app/api/recitation/route";
import { getPerekByPerekId } from "@/data/perek-dto";
import packageJson from "../../../../package.json";

const chapter = (id: number, status = "ready") => ({
	perekId: id,
	recitation: {
		version: 1,
		alignmentStatus: status,
		audioUrl: `https://example.com/recordings/${id}_record.mp3`,
		audioSha256: "a".repeat(64),
		textSha256: createHash("sha256").update("1:1:בראשית").digest("hex"),
		durationMs: 5000,
	},
	pesukim: [
		{
			segments: [
				{
					type: "qri",
					value: "בראשית",
					recordingTimeFrame:
						status === "ready"
							? { from: "00:00:00.101", to: "00:00:00.599" }
							: { from: "00:00:00", to: "00:00:00" },
				},
			],
		},
	],
});
const environment = process.env;
beforeEach(() => {
	process.env = { ...environment };
	delete process.env.S3_ENDPOINT;
	delete process.env.S3_BUCKET;
	delete process.env.S3_REGION;
	(getPerekByPerekId as jest.Mock).mockImplementation((id: number) =>
		id === 1 ? chapter(1) : id === 2 ? chapter(2, "pending") : { perekId: id },
	);
});
afterEach(() => {
	process.env = environment;
	jest.restoreAllMocks();
});

test("extension covers recordings independently and exports only approved word intervals", async () => {
	const response = await GET(new Request("http://localhost/api/recitation"));
	expect(response.status).toBe(200);
	expect(response.headers.get("X-Website-Version")).toBe(packageJson.version);
	const data = await response.json();
	expect(data.version).toBe(1);
	expect(data.tracks).toHaveLength(2);
	expect(data.tracks[0].words).toEqual([
		{ pasuk: 1, segment: 1, text: "בראשית", startMs: 101, endMs: 599 },
	]);
	expect(data.tracks[1].words).toEqual([]);
	expect(data.tracks[1].alignmentStatus).toBe("pending");
	const etag = response.headers.get("ETag") ?? "missing-etag";
	expect(
		(
			await GET(
				new Request("http://localhost/api/recitation", {
					headers: { "If-None-Match": etag },
				}),
			)
		).status,
	).toBe(304);
});

test("extension uses RustFS settings for every recording", async () => {
	process.env.S3_ENDPOINT = "http://localhost:4566/";
	process.env.S3_BUCKET = "test-assets";
	const data = await (
		await GET(new Request("http://localhost/api/recitation"))
	).json();
	expect(data.tracks.map((t: { audioUrl: string }) => t.audioUrl)).toEqual([
		"http://localhost:4566/test-assets/recordings/1_record.mp3",
		"http://localhost:4566/test-assets/recordings/2_record.mp3",
	]);
});

test("corrupt canonical text cannot publish a partial extension", async () => {
	jest.spyOn(console, "error").mockImplementation(() => {});
	(getPerekByPerekId as jest.Mock).mockReturnValue({
		...chapter(1),
		recitation: { ...chapter(1).recitation, textSha256: "b".repeat(64) },
	});
	expect(
		(await GET(new Request("http://localhost/api/recitation"))).status,
	).toBe(500);
});
