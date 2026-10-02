/** @jest-environment node */
jest.mock("@/data/perek-dto", () => ({ getPerekByPerekId: jest.fn() }));

import { createHash } from "node:crypto";
import { GET } from "@/app/api/recitation/[perekId]/route";
import { getPerekByPerekId } from "@/data/perek-dto";
import packageJson from "../../../../package.json";

const originalEnv = process.env;
const chapter = () => ({
	perekId: 1,
	recitation: {
		version: 1,
		audioSha256: "a".repeat(64),
		textSha256: createHash("sha256").update("1:1:בראשית").digest("hex"),
		durationMs: 5000,
		audioUrl:
			"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3",
		alignmentStatus: "ready",
	},
	pesukim: [
		{
			segments: [
				{
					type: "qri",
					value: "בראשית",
					recordingTimeFrame: { from: "00:00:01.442", to: "00:00:02.144" },
				},
			],
		},
	],
});
const request = (perekId = "1") =>
	GET(new Request(`http://localhost/api/recitation/${perekId}`), {
		params: Promise.resolve({ perekId }),
	});
beforeEach(() => {
	process.env = { ...originalEnv };
	delete process.env.S3_ENDPOINT;
	delete process.env.S3_BUCKET;
	delete process.env.S3_REGION;
	(getPerekByPerekId as jest.Mock).mockReturnValue(chapter());
});
afterEach(() => {
	process.env = originalEnv;
	jest.restoreAllMocks();
});

test("uses canonical segment timestamps without public sidecar files", async () => {
	const response = await request();
	expect(response.headers.get("X-Website-Version")).toBe(packageJson.version);
	const data = await response.json();
	expect(data.audioUrl).toBe(chapter().recitation.audioUrl);
	expect(data.words).toEqual([
		{ pasuk: 1, segment: 1, text: "בראשית", startMs: 1442, endMs: 2144 },
	]);
	process.env.S3_ENDPOINT = "http://localhost:4566/";
	process.env.S3_BUCKET = "bible-on-site-assets-test";
	expect((await (await request()).json()).audioUrl).toBe(
		"http://localhost:4566/bible-on-site-assets-test/recordings/1_record.mp3",
	);
});
test.each(["0", "930", "../1", "1.0", "01"])(
	"invalid chapter %s cannot access data",
	async (id) => {
		expect((await request(id)).status).toBe(400);
		expect(getPerekByPerekId).not.toHaveBeenCalled();
	},
);
test("missing recording metadata returns 404", async () => {
	(getPerekByPerekId as jest.Mock).mockReturnValue({
		...chapter(),
		recitation: undefined,
	});
	expect((await request()).status).toBe(404);
});
test("changed canonical text cannot reuse stale timing metadata", async () => {
	jest.spyOn(console, "error").mockImplementation(() => {});
	const data = chapter();
	data.pesukim[0].segments[0].value = "שונה";
	(getPerekByPerekId as jest.Mock).mockReturnValue(data);
	expect((await request()).status).toBe(500);
});
test("ready chapters cannot contain unaligned placeholders", async () => {
	jest.spyOn(console, "error").mockImplementation(() => {});
	const data = chapter();
	data.pesukim[0].segments[0].recordingTimeFrame = {
		from: "00:00:00",
		to: "00:00:00",
	};
	(getPerekByPerekId as jest.Mock).mockReturnValue(data);
	expect((await request()).status).toBe(500);
});

test.each(["00:60:00", "00:00:60", "1:02:03", "00:00:01.44", "invalid"])(
	"invalid canonical recording timestamp %s returns a safe server error",
	async (timestamp) => {
		jest.spyOn(console, "error").mockImplementation(() => {});
		const data = chapter();
		data.pesukim[0].segments[0].recordingTimeFrame.from = timestamp;
		(getPerekByPerekId as jest.Mock).mockReturnValue(data);
		expect((await request()).status).toBe(500);
	},
);
