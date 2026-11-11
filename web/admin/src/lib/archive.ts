/** Decimal GB, matching the quota controls and the advertised 1 TB default. */
export const GB = 1_000_000_000;
export const DEFAULT_QUOTA = 1000 * GB;
export const MAX_FILE_SIZE = 5_000 * GB;
export const ROOT_DIRECTORY = "00000000-0000-0000-0000-000000000001";
export const AUTHORS_DIRECTORY = "00000000-0000-0000-0000-000000000002";
export interface ArchiveUser {
	id: string;
	username: string;
	name?: string;
	role?: "archiver" | "admin";
}
export function isUploadId(value: unknown): value is string {
	if (typeof value !== "string" || value.length !== 36) return false;
	for (let index = 0; index < 36; index++) {
		const character = value[index].toLowerCase();
		if (index === 8 || index === 13 || index === 18 || index === 23) {
			if (character !== "-") return false;
		} else if (!"0123456789abcdef".includes(character)) return false;
	}
	return true;
}

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
		filename === "." ||
		filename === ".."
	) {
		throw new UploadError("שם הקובץ אינו תקין");
	}
	for (const character of filename) {
		const code = character.codePointAt(0) as number;
		if (
			code < 32 ||
			code === 127 ||
			code === 47 ||
			code === 92 ||
			(code >= 0xd800 && code <= 0xdfff)
		)
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

export function objectKey(directoryPath: string, filename: string): string {
	validateFile(filename, 0);
	const key = `${directoryPath}${filename}`;
	if (new TextEncoder().encode(key).byteLength > 1024)
		throw new UploadError("נתיב הקובץ ארוך מדי");
	if (directoryPath) {
		if (!directoryPath.endsWith("/") || directoryPath.startsWith("/"))
			throw new UploadError("נתיב תיקייה אינו תקין");
		for (const segment of directoryPath.slice(0, -1).split("/"))
			validateFile(segment, 0);
	}
	return key;
}

export interface UploadFile {
	id: string;
	ownerId: string;
	directoryId: string;
	key: string;
	filename: string;
	size: number;
	partSize: number;
	uploadId: string | null;
	status: "initializing" | "uploading" | "ready" | "deleting";
	createdAt: string;
	updatedAt: string;
}

export interface Directory {
	username: string;
	isAdmin: boolean;
	id: string;
	homeId: string;
	path: string;
	quotaName: string;
	breadcrumbs: { id: string; name: string }[];
	quota: number;
	allocated: number;
	files: (Omit<UploadFile, "uploadId" | "key" | "ownerId" | "directoryId"> & {
		kind: "file" | "folder";
	})[];
	nextCursor: string | null;
}
