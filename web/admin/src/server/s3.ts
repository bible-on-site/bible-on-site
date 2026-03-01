import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";

// S3 configuration from environment
const S3_REGION =
	process.env.S3_REGION || process.env.AWS_REGION || "il-central-1";
const S3_BUCKET = process.env.S3_BUCKET || "bible-on-site-assets";
const S3_ENDPOINT = process.env.S3_ENDPOINT; // Optional: for MinIO
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true"; // Required for MinIO
const S3_ACCESS_KEY =
	process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET_KEY =
	process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

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
	if (S3_ENDPOINT) {
		// MinIO style URL
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

export async function deleteImage(imageUrl: string): Promise<void> {
	// Extract key from URL - handle both S3 and MinIO URLs
	const url = new URL(imageUrl);
	let key: string;

	if (S3_ENDPOINT && imageUrl.startsWith(S3_ENDPOINT)) {
		// MinIO style: endpoint/bucket/key
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
	.inputValidator((data: UploadAuthorImageInput) => data)
	.handler(async ({ data }) => {
		const { authorId, contentType, base64Data } = data;

		// Convert base64 to buffer
		const buffer = Buffer.from(base64Data, "base64");

		// Upload to S3 — no DB update needed, URL is derived from the author ID
		await uploadImage(buffer, contentType, authorId);

		return { imageUrl: getAuthorImageUrl(authorId) };
	});
