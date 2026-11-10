/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/uploads/store", () => ({
	uploadStore: { locked: jest.fn(), file: jest.fn(), readFile: jest.fn() },
}));

import { ReadableStream } from "node:stream/web";
import { S3Client } from "@aws-sdk/client-s3";
import {
	beginUpload,
	completeUpload,
	downloadUpload,
	exactBody,
	removeUpload,
	uploadPart,
} from "@/lib/uploads/storage";
import { uploadStore } from "@/lib/uploads/store";
import {
	GB,
	objectKey,
	quotaBytes,
	validateFile,
} from "../../../../shared/private-upload";

const user = { id: "11111111-1111-1111-1111-111111111111", username: "alice" };
const id = "22222222-2222-2222-2222-222222222222";
const tx = { execute: jest.fn(), query: jest.fn() };
let quota: number;
let allocated: number;
let file: {
	id: string;
	filename: string;
	size: number;
	partSize: number;
	uploadId: string | null;
	status: string;
};
const send = jest.spyOn(S3Client.prototype, "send") as jest.Mock;

beforeEach(() => {
	process.env.UPLOAD_S3_BUCKET = "private-test";
	quota = 1000 * GB;
	allocated = 0;
	file = {
		id,
		filename: "תוכן.html",
		size: 6,
		partSize: 4,
		uploadId: "private-multipart-id",
		status: "uploading",
	};
	(uploadStore.locked as jest.Mock).mockImplementation((_id, _username, fn) =>
		fn(tx, quota, allocated),
	);
	(uploadStore.file as jest.Mock).mockImplementation(async () => file);
	(uploadStore.readFile as jest.Mock).mockImplementation(async () => file);
	send.mockImplementation(async (command) => {
		switch (command.constructor.name) {
			case "CreateMultipartUploadCommand":
				return { UploadId: "private-multipart-id" };
			case "ListPartsCommand":
				return {
					Parts: [
						{ PartNumber: 1, ETag: "a", Size: 4 },
						{ PartNumber: 2, ETag: "b", Size: 2 },
					],
				};
			case "HeadObjectCommand":
				return { ContentLength: file.size };
			case "GetObjectCommand":
				return { Body: { transformToWebStream: () => "stream" } };
			case "UploadPartCommand": {
				for await (const _ of command.input.Body) {
					/* consume the validated stream */
				}
				return {};
			}
			default:
				return {};
		}
	});
});

it("accepts arbitrary file types and safe empty files, using immutable account prefixes", () => {
	expect(validateFile("תוכן.exe", 0).partSize).toBe(8 * 1024 * 1024);
	expect(validateFile("large.iso", 1_000 * GB).partSize).toBe(100_000_000);
	expect(objectKey(user.id, id)).toBe(`users/${user.id}/${id}`);
	expect(() => objectKey("../alice", id)).toThrow();
	expect(quotaBytes(1000)).toBe(1_000_000_000_000);
	for (const gb of [-1, 0.1, "1", Number.NaN, 100001])
		expect(() => quotaBytes(gb)).toThrow();
});

it.each([
	"",
	" ",
	".",
	"..",
	"../x",
	"a/b",
	"a\\b",
	"a\n",
	"a\x7f",
	"a".repeat(256),
	null,
])("rejects unsafe filename %s", (name) => {
	expect(() => validateFile(name, 1)).toThrow();
});
it.each([-1, 1.5, Number.NaN, "3", null, 5_001 * GB])(
	"rejects invalid size %s",
	(size) => {
		expect(() => validateFile("file", size)).toThrow();
	},
);

it("fails closed when private storage is not configured", async () => {
	delete process.env.UPLOAD_S3_BUCKET;
	await expect(beginUpload(user, "a", 1)).rejects.toMatchObject({
		status: 503,
	});
});
it("reserves the complete size before accepting any content", async () => {
	const started = await beginUpload(user, "a.zip", 7);
	expect(tx.execute).toHaveBeenCalledWith(
		expect.stringContaining("INSERT INTO private_upload_file"),
		[
			started.id,
			user.id,
			"a.zip",
			7,
			started.partSize,
			"private-multipart-id",
			"uploading",
		],
	);
	expect(send.mock.calls[0][0].input).toMatchObject({
		Bucket: "private-test",
		Key: `users/${user.id}/${started.id}`,
		ContentType: "application/octet-stream",
		ServerSideEncryption: "AES256",
	});
	expect(started).not.toHaveProperty("uploadId");
});
it("rejects uploads exceeding remaining quota, including prior reservations", async () => {
	quota = 10;
	allocated = 7;
	await expect(beginUpload(user, "a", 4)).rejects.toMatchObject({
		status: 413,
	});
	expect(send).not.toHaveBeenCalled();
});
it("accepts exactly the remaining quota and empty files", async () => {
	quota = 3;
	allocated = 1;
	await beginUpload(user, "binary", 2);
	await beginUpload(user, "empty", 0);
	expect(tx.execute.mock.calls[1][1].slice(-2)).toEqual([null, "ready"]);
	expect(send.mock.calls[1][0].constructor.name).toBe("PutObjectCommand");
});
it("requires an S3 multipart ID", async () => {
	send.mockResolvedValue({});
	await expect(beginUpload(user, "a", 1)).rejects.toThrow("S3 did not return");
});

async function collect(stream: ReturnType<typeof exactBody>) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
}
function body(bytes: number) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		},
	}) as unknown as globalThis.ReadableStream<Uint8Array>;
}
it("streams only the reserved number of bytes", async () => {
	expect((await collect(exactBody(body(4), 4))).length).toBe(4);
	await expect(collect(exactBody(body(5), 4))).rejects.toThrow("גודל החלק");
	await expect(collect(exactBody(body(3), 4))).rejects.toThrow("גודל החלק");
});
it("uploads a final part with its precise server-calculated length", async () => {
	await uploadPart(
		user,
		id,
		2,
		new Request("https://site/upload/api", {
			method: "PUT",
			body: new Uint8Array(2),
		}),
	);
	expect(send.mock.calls[0][0].input).toMatchObject({
		PartNumber: 2,
		ContentLength: 2,
		UploadId: file.uploadId,
	});
	expect(uploadStore.readFile).toHaveBeenCalledWith(user.id, id);
	expect(uploadStore.locked).not.toHaveBeenCalled();
});
it.each([0, -1, 3, 1.2, Number.NaN])(
	"rejects invalid part number %s",
	async (part) => {
		await expect(
			uploadPart(
				user,
				id,
				part,
				new Request("https://site", { method: "PUT", body: "aa" }),
			),
		).rejects.toThrow();
	},
);
it("rejects missing bodies, completed files and missing upload IDs", async () => {
	await expect(
		uploadPart(user, id, 1, new Request("https://site")),
	).rejects.toThrow();
	file.status = "ready";
	await expect(
		uploadPart(
			user,
			id,
			1,
			new Request("https://site", { method: "PUT", body: "aaaa" }),
		),
	).rejects.toThrow();
	file.status = "uploading";
	file.uploadId = null;
	await expect(
		uploadPart(
			user,
			id,
			1,
			new Request("https://site", { method: "PUT", body: "aaaa" }),
		),
	).rejects.toThrow();
});
it("completes only S3-verified parts and records readiness after checking object size", async () => {
	await completeUpload(user, id);
	expect(send.mock.calls[1][0].input.MultipartUpload.Parts).toEqual([
		{ PartNumber: 1, ETag: "a" },
		{ PartNumber: 2, ETag: "b" },
	]);
	expect(tx.execute).toHaveBeenCalledWith(
		expect.stringContaining("SET status = 'ready'"),
		[id, user.id],
	);
});
it("paginates S3 parts", async () => {
	send
		.mockResolvedValueOnce({
			IsTruncated: true,
			NextPartNumberMarker: "1",
			Parts: [{ PartNumber: 1, ETag: "a", Size: 4 }],
		})
		.mockResolvedValueOnce({ Parts: [{ PartNumber: 2, ETag: "b", Size: 2 }] })
		.mockResolvedValueOnce({})
		.mockResolvedValueOnce({ ContentLength: 6 });
	await completeUpload(user, id);
	expect(send.mock.calls[1][0].input.PartNumberMarker).toBe("1");
});
it.each([
	{ Parts: [] },
	{},
	{ Parts: [{ PartNumber: 2, Size: 4, ETag: "x" }] },
	{ Parts: [{ PartNumber: 1, Size: 3, ETag: "x" }] },
	{ Parts: [{ PartNumber: 1, Size: 4 }] },
])("refuses incomplete or tampered multipart data", async (result) => {
	send.mockResolvedValueOnce(result);
	await expect(completeUpload(user, id)).rejects.toThrow("הקובץ עדיין");
	expect(tx.execute).not.toHaveBeenCalled();
});
it("recovers after S3 completed but the database commit failed", async () => {
	send
		.mockRejectedValueOnce(
			Object.assign(new Error("gone"), { name: "NoSuchUpload" }),
		)
		.mockResolvedValueOnce({ ContentLength: 6 });
	await completeUpload(user, id);
	expect(tx.execute).toHaveBeenCalled();
});
it("does not hide S3 failures or size mismatches", async () => {
	send.mockRejectedValueOnce(new Error("S3 failed"));
	await expect(completeUpload(user, id)).rejects.toThrow("S3 failed");
	send
		.mockResolvedValueOnce({
			Parts: [
				{ PartNumber: 1, ETag: "a", Size: 4 },
				{ PartNumber: 2, ETag: "b", Size: 2 },
			],
		})
		.mockResolvedValueOnce({})
		.mockResolvedValueOnce({ ContentLength: 7 });
	await expect(completeUpload(user, id)).rejects.toThrow("גודל הקובץ");
});
it("makes completion retries idempotent", async () => {
	file.status = "ready";
	await completeUpload(user, id);
	expect(send).not.toHaveBeenCalled();
});
it("aborts multipart data and releases a reservation only after object cleanup", async () => {
	await removeUpload(user, id);
	expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
		"AbortMultipartUploadCommand",
		"DeleteObjectCommand",
	]);
	expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [
		id,
		user.id,
	]);
});
it("deletes completed files without aborting, and handles an expired upload", async () => {
	file.uploadId = null;
	await removeUpload(user, id);
	expect(send.mock.calls[0][0].constructor.name).toBe("DeleteObjectCommand");
	file.uploadId = "expired";
	send.mockRejectedValueOnce(
		Object.assign(new Error(), { name: "NoSuchUpload" }),
	);
	await removeUpload(user, id);
});
it("preserves reservations when cleanup fails", async () => {
	send.mockRejectedValueOnce(new Error("S3 failed"));
	await expect(removeUpload(user, id)).rejects.toThrow();
	expect(tx.execute).not.toHaveBeenCalled();
});
it("downloads only ready, owned files through the service", async () => {
	await expect(downloadUpload(user, id)).rejects.toMatchObject({ status: 409 });
	file.status = "ready";
	expect(await downloadUpload(user, id)).toMatchObject({
		body: "stream",
		file: { filename: "תוכן.html" },
	});
	expect(send.mock.calls[0][0].input.Key).toBe(objectKey(user.id, id));
});
it("supports an empty S3 response without exposing a bucket URL", async () => {
	file.status = "ready";
	send.mockResolvedValue({});
	expect((await downloadUpload(user, id)).body).toBeUndefined();
});
