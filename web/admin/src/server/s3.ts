import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";

// S3 configuration from environment
const S3_ENDPOINT = process.env.S3_ENDPOINT; // Optional: for local S3 (RustFS)
const S3_REGION = S3_ENDPOINT
	? "us-east-1"
	: process.env.S3_REGION || process.env.AWS_REGION || "il-central-1";
const S3_BUCKET = process.env.S3_BUCKET || "bible-on-site-assets";
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true"; // Required for local S3
const S3_ACCESS_KEY =
	process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET_KEY =
	process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
// CDN distribution domain in production (see docs/aws/cloudformation/cloudfront-assets.yaml)
const ASSETS_BASE_URL = process.env.ASSETS_BASE_URL;

const s3Client = new S3Client({
	region: S3_REGION,
	...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
	...(S3_FORCE_PATH_STYLE && { forcePathStyle: true }),
	...(S3_ACCESS_KEY &&
		S3_SECRET_KEY && {
			credentials: {
				accessKeyId: S3_ACCESS_KEY,
				secretAccessKey: S3_SECRET_KEY,
			},
		}),
});

// Build the public URL based on configuration
function getPublicUrl(key: string): string {
	if (ASSETS_BASE_URL) {
		// CDN domain (CloudFront) — bucket path is implicit
		return `${ASSETS_BASE_URL.replace(/\/+$/, "")}/${key}`;
	}
	if (S3_ENDPOINT) {
		// Local path-style S3 URL
		return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
	}
	// Standard AWS S3 URL
	return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

/**
 * Build the public URL for an author image based on their ID.
 * Images live in S3 at: authors/high-res/{id}.jpg
 * There is NO image_url column in tanah_author — URLs are always derived from the ID.
 */
export function getAuthorImageUrl(authorId: number): string {
	return getPublicUrl(`authors/high-res/${authorId}.jpg`);
}

export async function uploadImage(
	buffer: Buffer,
	_mimetype: string, // Kept for future validation; currently we force JPEG
	authorId: number,
): Promise<string> {
	// Production pattern: authors/high-res/{id}.jpg
	const key = `authors/high-res/${authorId}.jpg`;

	await s3Client.send(
		new PutObjectCommand({
			Bucket: S3_BUCKET,
			Key: key,
			Body: buffer,
			ContentType: "image/jpeg",
			CacheControl: "max-age=31536000", // 1 year
		}),
	);

	// Return the public URL
	return getPublicUrl(key);
}

const PEDIA_IMAGE_CONTENT_TYPES: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/**
 * Upload a Tanahpedia image asset (#3769). Each upload gets a fresh object
 * key under `pedia/images/` — the `tanahpedia_image.url` row stores the
 * returned public URL. Content type maps to the extension; anything else is
 * rejected before it can be published under a wrong extension.
 */
export async function uploadPediaImage(
	buffer: Buffer,
	contentType: string,
): Promise<string> {
	const ext = PEDIA_IMAGE_CONTENT_TYPES[contentType];
	if (!ext) {
		throw new Error(`Unsupported image content type: ${contentType}`);
	}
	const key = `pedia/images/${crypto.randomUUID()}.${ext}`;

	await s3Client.send(
		new PutObjectCommand({
			Bucket: S3_BUCKET,
			Key: key,
			Body: buffer,
			ContentType: contentType,
			CacheControl: "max-age=31536000", // 1 year
		}),
	);

	return getPublicUrl(key);
}

export async function deleteImage(imageUrl: string): Promise<void> {
	// Extract key from URL - handle both AWS and local S3 URLs
	const url = new URL(imageUrl);
	let key: string;

	if (S3_ENDPOINT && imageUrl.startsWith(S3_ENDPOINT)) {
		// Local path-style: endpoint/bucket/key
		const pathParts = url.pathname.split("/").filter(Boolean);
		key = pathParts.slice(1).join("/"); // Skip bucket name
	} else {
		// Standard S3: bucket.s3.region.amazonaws.com/key
		key = url.pathname.slice(1); // Remove leading slash
	}

	await s3Client.send(
		new DeleteObjectCommand({
			Bucket: S3_BUCKET,
			Key: key,
		}),
	);
}

export async function getPresignedUploadUrl(
	authorId: number,
): Promise<{ uploadUrl: string; publicUrl: string }> {
	// Production pattern: authors/high-res/{id}.jpg
	const key = `authors/high-res/${authorId}.jpg`;

	const command = new PutObjectCommand({
		Bucket: S3_BUCKET,
		Key: key,
		ContentType: "image/jpeg",
		CacheControl: "max-age=31536000",
	});

	const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
	const publicUrl = getPublicUrl(key);

	return { uploadUrl, publicUrl };
}

interface UploadAuthorImageInput {
	authorId: number;
	fileName: string;
	contentType: string;
	base64Data: string;
}

// Server function to upload author image
export const uploadAuthorImage = createServerFn({ method: "POST" })
	.validator((data: UploadAuthorImageInput) => data)
	.handler(async ({ data }) => {
		const { authorId, contentType, base64Data } = data;

		// Convert base64 to buffer
		const buffer = Buffer.from(base64Data, "base64");

		// Upload to S3 — no DB update needed, URL is derived from the author ID
		await uploadImage(buffer, contentType, authorId);

		return { imageUrl: getAuthorImageUrl(authorId) };
	});

export const PEDIA_IMAGE_CHUNK_BYTES = 384 * 1024;
export const MAX_PEDIA_IMAGE_BYTES = 8 * 1024 * 1024;
const PENDING_UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_UPLOADS = 16;

interface PendingPediaUpload {
	contentType: string;
	totalSize: number;
	chunks: (Buffer | undefined)[];
	receivedBytes: number;
	expiresAt: number;
}

// shortcut: pending chunks are process-local, correct for the single admin ECS
// task; move reservation state to MySQL/S3 multipart if admin ever scales out.
const pendingPediaUploads = new Map<string, PendingPediaUpload>();

function cleanupPendingPediaUploads(): void {
	const now = Date.now();
	for (const [id, upload] of pendingPediaUploads) {
		if (upload.expiresAt <= now) pendingPediaUploads.delete(id);
	}
	while (pendingPediaUploads.size >= MAX_PENDING_UPLOADS) {
		const oldest = pendingPediaUploads.keys().next().value;
		if (!oldest) break;
		pendingPediaUploads.delete(oldest);
	}
}

interface CreatePediaImageUploadInput {
	contentType: string;
	totalSize: number;
}

/**
 * Start a bounded chunked upload. Every chunk request stays far below the
 * production admin proxy's 1 MiB body limit while the assembled image itself
 * may be an ordinary photo (up to 8 MiB).
 */
export const createPediaImageUpload = createServerFn({ method: "POST" })
	.validator((data: CreatePediaImageUploadInput) => data)
	.handler(async ({ data }) => {
		if (!PEDIA_IMAGE_CONTENT_TYPES[data.contentType]) {
			throw new Error("Unsupported image content type");
		}
		if (!Number.isInteger(data.totalSize) || data.totalSize <= 0 || data.totalSize > MAX_PEDIA_IMAGE_BYTES) {
			throw new Error("Image size must be between 1 byte and 8 MiB");
		}
		cleanupPendingPediaUploads();
		const uploadId = crypto.randomUUID();
		const chunkCount = Math.ceil(data.totalSize / PEDIA_IMAGE_CHUNK_BYTES);
		pendingPediaUploads.set(uploadId, {
			contentType: data.contentType,
			totalSize: data.totalSize,
			chunks: Array.from({ length: chunkCount }),
			receivedBytes: 0,
			expiresAt: Date.now() + PENDING_UPLOAD_TTL_MS,
		});
		return { uploadId, chunkBytes: PEDIA_IMAGE_CHUNK_BYTES, chunkCount };
	});

interface UploadPediaImageChunkInput {
	uploadId: string;
	chunkIndex: number;
	base64Data: string;
}

/** Append one chunk; the final complete chunk assembles and publishes to S3. */
export const uploadPediaImageChunk = createServerFn({ method: "POST" })
	.validator((data: UploadPediaImageChunkInput) => data)
	.handler(async ({ data }) => {
		const pending = pendingPediaUploads.get(data.uploadId);
		if (!pending || pending.expiresAt <= Date.now()) {
			throw new Error("Upload expired or was not found");
		}
		if (!Number.isInteger(data.chunkIndex) || data.chunkIndex < 0 || data.chunkIndex >= pending.chunks.length) {
			throw new Error("Invalid image upload chunk");
		}
		if (pending.chunks[data.chunkIndex]) {
			throw new Error("Image upload chunk was already received");
		}
		const chunk = Buffer.from(data.base64Data, "base64");
		const expected = Math.min(
			PEDIA_IMAGE_CHUNK_BYTES,
			pending.totalSize - data.chunkIndex * PEDIA_IMAGE_CHUNK_BYTES,
		);
		if (chunk.length !== expected) {
			throw new Error("Image upload chunk size mismatch");
		}
		pending.chunks[data.chunkIndex] = chunk;
		pending.receivedBytes += chunk.length;
		if (pending.receivedBytes < pending.totalSize) {
			return { complete: false as const, receivedBytes: pending.receivedBytes };
		}
		const buffer = Buffer.concat(pending.chunks as Buffer[]);
		if (buffer.length !== pending.totalSize) {
			throw new Error("Image upload size mismatch");
		}
		pendingPediaUploads.delete(data.uploadId);
		const imageUrl = await uploadPediaImage(buffer, pending.contentType);
		return { complete: true as const, receivedBytes: pending.receivedBytes, imageUrl };
	});

/** Test hook: process-local pending uploads must not leak across cases. */
export function __resetPediaImageUploadsForTests(): void {
	pendingPediaUploads.clear();
}
