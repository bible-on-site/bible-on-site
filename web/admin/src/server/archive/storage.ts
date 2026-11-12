import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListPartsCommand,
	PutObjectCommand,
	S3Client,
	UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
	type ArchiveUser,
	UploadError,
	type UploadFile,
	validateFile,
} from "~/lib/archive";
import { archiveStore } from "./database";

let client: S3Client | undefined;
function storage() {
	const bucket = process.env.ARCHIVE_S3_BUCKET;
	if (!bucket) throw new UploadError("אזור ההעלאה עדיין אינו זמין", 503);
	client ??= new S3Client({
		region: process.env.ARCHIVE_AWS_REGION || "il-central-1",
		requestChecksumCalculation: "WHEN_REQUIRED",
		...(process.env.NODE_ENV !== "production" && process.env.ARCHIVE_S3_ENDPOINT
			? { endpoint: process.env.ARCHIVE_S3_ENDPOINT, forcePathStyle: true }
			: {}),
	});
	return { client, bucket };
}
type User = ArchiveUser;

export async function beginUpload(
	user: User,
	filename: unknown,
	size: unknown,
	directoryId = "",
) {
	const file = validateFile(filename, size);
	const { client, bucket } = storage();
	const reserved = await archiveStore.reserve(
		user,
		randomUUID(),
		file.filename,
		file.size,
		file.partSize,
		directoryId,
	);
	// Commit the reservation before S3 can hold any object bytes.
	await archiveStore.lockedFile(user, reserved.id, async (tx, pending) => {
		if (pending.status !== "initializing")
			throw new UploadError("ההעלאה בוטלה", 409);
		const id = reserved.id;
		const key = pending.key;
		let uploadId: string | null = null;
		if (file.size === 0) {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: new Uint8Array(),
					ContentType: "application/octet-stream",
					ServerSideEncryption: "AES256",
				}),
			);
		} else {
			const upload = await client.send(
				new CreateMultipartUploadCommand({
					Bucket: bucket,
					Key: key,
					ContentType: "application/octet-stream",
					ServerSideEncryption: "AES256",
				}),
			);
			if (!upload.UploadId) throw new Error("S3 did not return an upload ID");
			uploadId = upload.UploadId;
		}
		await tx.execute(
			"UPDATE private_upload_file SET upload_id = ?, status = ? WHERE id = ? AND user_id = ?",
			[uploadId, file.size === 0 ? "ready" : "uploading", id, pending.ownerId],
		);
	});
	return reserved;
}

/** A bounded stream prevents a forged Content-Length from consuming storage beyond its reservation. */
export function exactBody(body: ReadableStream<Uint8Array>, expected: number) {
	return Readable.from(
		(async function* () {
			let total = 0;
			const reader = body.getReader();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					total += value.byteLength;
					if (total > expected) throw new UploadError("גודל החלק אינו תואם");
					yield value;
				}
				if (total !== expected) throw new UploadError("גודל החלק אינו תואם");
			} finally {
				await reader.cancel();
				reader.releaseLock();
			}
		})(),
		{ objectMode: false },
	);
}

export async function uploadPart(
	user: User,
	id: string,
	partNumber: number,
	request: Request,
) {
	const { client, bucket } = storage();
	// Do not hold a database connection while the browser streams a large part.
	// A concurrent cancellation invalidates the S3 upload ID; completion verifies all parts again.
	const file = await archiveStore.readFile(user, id);
	const count = Math.ceil(file.size / file.partSize);
	if (
		file.status !== "uploading" ||
		!file.uploadId ||
		!Number.isInteger(partNumber) ||
		partNumber < 1 ||
		partNumber > count ||
		!request.body
	)
		throw new UploadError("חלק העלאה אינו תקין");
	const size = Math.min(
		file.partSize,
		file.size - (partNumber - 1) * file.partSize,
	);
	const body = exactBody(request.body, size);
	try {
		await client.send(
			new UploadPartCommand({
				Bucket: bucket,
				Key: file.key,
				UploadId: file.uploadId,
				PartNumber: partNumber,
				ContentLength: size,
				Body: body,
			}),
		);
	} finally {
		body.destroy();
	}
}

function missingUpload(error: unknown) {
	return error instanceof Error && error.name === "NoSuchUpload";
}

export async function completeUpload(user: User, id: string) {
	const { client, bucket } = storage();
	return archiveStore.lockedFile(user, id, async (tx, file) => {
		if (file.status === "ready") return;
		if (file.status === "deleting" || (file.size > 0 && !file.uploadId))
			throw new UploadError("יש לבטל את ההעלאה ולנסות שוב", 409);
		const key = file.key;
		const parts: { PartNumber: number; ETag: string }[] = [];
		let marker: string | undefined;
		if (file.size > 0) {
			try {
				do {
					const page = await client.send(
						new ListPartsCommand({
							Bucket: bucket,
							Key: key,
							UploadId: file.uploadId ?? undefined,
							PartNumberMarker: marker,
						}),
					);
					for (const part of page.Parts ?? []) {
						const number = parts.length + 1;
						const expected = Math.min(
							file.partSize,
							file.size - (number - 1) * file.partSize,
						);
						if (
							part.PartNumber !== number ||
							part.Size !== expected ||
							!part.ETag
						)
							throw new UploadError("הקובץ עדיין לא הועלה במלואו");
						parts.push({ PartNumber: number, ETag: part.ETag });
					}
					marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
				} while (marker);
				if (parts.length !== Math.ceil(file.size / file.partSize))
					throw new UploadError("הקובץ עדיין לא הועלה במלואו");
				await client.send(
					new CompleteMultipartUploadCommand({
						Bucket: bucket,
						Key: key,
						UploadId: file.uploadId ?? undefined,
						MultipartUpload: { Parts: parts },
					}),
				);
			} catch (error) {
				if (!missingUpload(error)) throw error;
				// Recover an S3 completion followed by a failed database commit.
			}
		}
		const object = await client.send(
			new HeadObjectCommand({ Bucket: bucket, Key: key }),
		);
		if (object.ContentLength !== file.size)
			throw new UploadError("גודל הקובץ אינו תואם");
		await tx.execute(
			"UPDATE private_upload_file SET status = 'ready', upload_id = NULL WHERE id = ? AND user_id = ?",
			[id, file.ownerId],
		);
	});
}

export async function removeUpload(user: User, id: string) {
	const { client, bucket } = storage();
	// Commit intent before S3 deletion, so a rollback can never resurrect a ready row.
	await archiveStore.lockedFile(user, id, async (tx, file) => {
		if (
			user.role !== "admin" &&
			file.status !== "initializing" &&
			file.status !== "uploading"
		)
			throw new UploadError("מחיקת קבצים שהושלמו מותרת למנהל בלבד", 403);
		await tx.execute(
			"UPDATE private_upload_file SET status = 'deleting' WHERE id = ? AND user_id = ?",
			[id, file.ownerId],
		);
	});
	return archiveStore.lockedFile(user, id, async (tx, file) => {
		const key = file.key;
		if (file.uploadId) {
			try {
				await client.send(
					new AbortMultipartUploadCommand({
						Bucket: bucket,
						Key: key,
						UploadId: file.uploadId,
					}),
				);
			} catch (error) {
				if (!missingUpload(error)) throw error;
			}
		}
		await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		await tx.execute(
			"DELETE FROM private_upload_file WHERE id = ? AND user_id = ?",
			[id, file.ownerId],
		);
	});
}

export async function downloadUpload(user: User, id: string) {
	const { client, bucket } = storage();
	let file: UploadFile | undefined;
	await archiveStore.lockedFile(user, id, async (_tx, selected) => {
		file = selected;
	});
	if (file?.status !== "ready")
		throw new UploadError("הקובץ אינו מוכן להורדה", 409);
	const object = await client.send(
		new GetObjectCommand({ Bucket: bucket, Key: file.key }),
	);
	return { file, body: object.Body?.transformToWebStream() };
}
