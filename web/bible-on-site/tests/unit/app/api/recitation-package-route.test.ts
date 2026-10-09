/** @jest-environment node */
jest.mock("@/data/perek-dto", () => ({ getPerekByPerekId: jest.fn() }));

import { createHash } from "node:crypto";
import packageJson from "../../../../package.json";

let GET: typeof import("@/app/api/recitation/route").GET;
let getPerekByPerekId: jest.Mock;

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
	jest.resetModules();
	GET = jest.requireActual("@/app/api/recitation/route").GET;
	getPerekByPerekId = jest.requireMock("@/data/perek-dto").getPerekByPerekId;
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

test("repeated requests and ETag checks reuse the fully validated immutable body", async () => {
	const first = await GET(new Request("http://localhost/api/recitation"));
	const body = await first.text();
	const etag = first.headers.get("ETag") as string;
	expect(getPerekByPerekId).toHaveBeenCalledTimes(929);
	const repeated = await GET(new Request("http://localhost/api/recitation"));
	expect(await repeated.text()).toBe(body);
	expect(repeated.headers.get("ETag")).toBe(etag);
	const unchanged = await GET(
		new Request("http://localhost/api/recitation", {
			headers: { "If-None-Match": etag },
		}),
	);
	expect(unchanged.status).toBe(304);
	expect(await unchanged.text()).toBe("");
	expect(getPerekByPerekId).toHaveBeenCalledTimes(929);
});

test.each([
	["S3_ENDPOINT", "http://localhost:4566", "http://localhost:4566/bible-on-site-assets/recordings/1_record.mp3"],
	["S3_BUCKET", "changed-assets", "https://changed-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3"],
	["S3_REGION", "us-east-1", "https://bible-on-site-assets.s3.us-east-1.amazonaws.com/recordings/1_record.mp3"],
])("a changed %s refreshes the cached URLs and ETag", async (variable, value, url) => {
	const first = await GET(new Request("http://localhost/api/recitation"));
	process.env[variable] = value;
	const changed = await GET(new Request("http://localhost/api/recitation"));
	expect(changed.headers.get("ETag")).not.toBe(first.headers.get("ETag"));
	expect((await changed.json()).tracks[0].audioUrl).toBe(url);
	expect(getPerekByPerekId).toHaveBeenCalledTimes(1858);
});

test("a failed validation leaves no partial cache and a later valid request can recover", async () => {
	jest.spyOn(console, "error").mockImplementation(() => {});
	getPerekByPerekId.mockImplementationOnce(() => {
		throw new Error("Canonical data unavailable");
	});
	expect((await GET(new Request("http://localhost/api/recitation"))).status).toBe(500);
	const recovered = await GET(new Request("http://localhost/api/recitation"));
	expect(recovered.status).toBe(200);
	expect((await recovered.json()).tracks).toHaveLength(2);
});
