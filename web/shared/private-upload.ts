/** Decimal GB, matching the quota controls and the advertised 1 TB default. */
export const GB = 1_000_000_000;
export const DEFAULT_QUOTA = 1000 * GB;
export const MAX_FILE_SIZE = 5_000 * GB;
export const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UploadError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}

export function validateFile(filename: unknown, size: unknown) {
	if (
		typeof filename !== "string" ||
		!filename.trim() ||
		filename.length > 255 ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters and path separators in user filenames.
		/[\x00-\x1f\x7f/\\]/.test(filename) ||
		filename === "." ||
		filename === ".."
	) {
		throw new UploadError("שם הקובץ אינו תקין");
	}
	if (
		typeof size !== "number" ||
		!Number.isSafeInteger(size) ||
		size < 0 ||
		size > MAX_FILE_SIZE
	) {
		throw new UploadError("גודל הקובץ אינו תקין");
	}
	// At most 10,000 parts, each at least 8 MiB except the final part.
	return {
		filename,
		size,
		partSize: Math.max(8 * 1024 * 1024, Math.ceil(size / 10_000)),
	};
}

export function quotaBytes(gb: unknown): number {
	if (
		typeof gb !== "number" ||
		!Number.isSafeInteger(gb) ||
		gb < 0 ||
		gb > 100_000
	)
		throw new UploadError("המכסה חייבת להיות מספר שלם בין 0 ל-100000 GB");
	return gb * GB;
}

export function objectKey(userId: string, id: string): string {
	if (!UUID.test(userId) || !UUID.test(id))
		throw new UploadError("מזהה אינו תקין");
	return `users/${userId}/${id}`;
}

export interface UploadFile {
	id: string;
	filename: string;
	size: number;
	partSize: number;
	uploadId: string | null;
	status: "uploading" | "ready";
	createdAt: string;
}

export interface Directory {
	username: string;
	quota: number;
	allocated: number;
	files: Omit<UploadFile, "uploadId">[];
}
