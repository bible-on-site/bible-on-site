/**
 * GitHub API helpers for baseline coverage artifacts and revision compares.
 *
 * Uses the REST API directly (no `gh` binary dependency) so the steps run on
 * every runner image — the Appium matrix includes the custom iOS runner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import type { ChangedFile } from "./model.ts";

const API = "https://api.github.com";

async function apiFetch(url: string, token: string): Promise<Response> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${response.status} for ${url}: ${await response.text()}`);
	}
	return response;
}

export interface ArtifactInfo {
	id: number;
	name: string;
	createdAt: string;
}

/** Returns the newest unexpired artifact with the exact name, if any. */
export async function findArtifact(
	repo: string,
	name: string,
	token: string,
): Promise<ArtifactInfo | null> {
	const response = await apiFetch(
		`${API}/repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}`,
		token,
	);
	const body = (await response.json()) as {
		artifacts: { id: number; name: string; expired: boolean; created_at: string }[];
	};
	const candidates = body.artifacts
		.filter((artifact) => !artifact.expired && artifact.name === name)
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
	const artifact = candidates[0];
	return artifact === undefined
		? null
		: { id: artifact.id, name: artifact.name, createdAt: artifact.created_at };
}

/** Downloads and extracts an artifact zip into `outDir`. */
export async function downloadArtifact(
	repo: string,
	artifact: ArtifactInfo,
	token: string,
	outDir: string,
): Promise<string[]> {
	const response = await apiFetch(
		`${API}/repos/${repo}/actions/artifacts/${artifact.id}/zip`,
		token,
	);
	const zip = Buffer.from(await response.arrayBuffer());
	return extractZip(zip, outDir);
}

/**
 * Minimal zip reader: stored and deflated entries via zlib. GitHub artifact
 * archives are small single-file zips — no streaming or encryption needed.
 */
export function extractZip(zip: Buffer, outDir: string): string[] {
	const eocdSignature = 0x06054b50;
	let eocd = -1;
	for (let i = zip.length - 22; i >= 0 && i >= zip.length - 65557; i--) {
		if (zip.readUInt32LE(i) === eocdSignature) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) throw new Error("Not a zip archive: no end-of-central-directory record");
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	const extracted: string[] = [];
	for (let i = 0; i < count; i++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`Corrupt zip: bad central directory entry ${i}`);
		}
		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const localOffset = zip.readUInt32LE(offset + 42);
		const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith("/")) continue; // directory entry
		if (name.includes("..")) throw new Error(`Unsafe zip entry: ${name}`);
		if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
			throw new Error(`Corrupt zip: bad local header for ${name}`);
		}
		const localNameLength = zip.readUInt16LE(localOffset + 26);
		const localExtraLength = zip.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const data = zip.subarray(dataStart, dataStart + compressedSize);
		const content =
			method === 0
				? data
				: method === 8
					? inflateRawSync(data)
					: (() => {
							throw new Error(`Unsupported zip method ${method} for ${name}`);
						})();
		const target = join(outDir, name);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		extracted.push(name);
	}
	return extracted;
}

export interface CompareResult {
	/** `ahead` — head contains base (base is an ancestor). */
	status: "ahead" | "behind" | "diverged" | "identical";
	mergeBaseSha: string;
	files: ChangedFile[];
	/** True when the API truncated the file list (over the 300-file page). */
	truncated: boolean;
}

const STATUS_MAP: Record<string, ChangedFile["status"]> = {
	added: "added",
	modified: "modified",
	changed: "modified",
	removed: "deleted",
	renamed: "renamed",
};

/** `GET /compare/{base}...{head}` — the accumulated snapshot→tested diff. */
export async function compareRevisions(
	repo: string,
	base: string,
	head: string,
	token: string,
): Promise<CompareResult> {
	const response = await apiFetch(
		`${API}/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
		token,
	);
	const body = (await response.json()) as {
		status: CompareResult["status"];
		merge_base_commit: { sha: string };
		files?: {
			filename: string;
			status: string;
			previous_filename?: string;
		}[];
	};
	const files = (body.files ?? []).map((file) => ({
		path: file.filename,
		status: STATUS_MAP[file.status] ?? "modified",
		...(file.previous_filename !== undefined
			? { previousPath: file.previous_filename }
			: {}),
	}));
	// The compare endpoint caps `files` at 300 entries.
	return {
		status: body.status,
		mergeBaseSha: body.merge_base_commit.sha,
		files,
		truncated: files.length >= 300,
	};
}
