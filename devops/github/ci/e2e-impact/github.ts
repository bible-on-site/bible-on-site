/**
 * GitHub API helpers for baseline coverage artifacts and revision compares.
 *
 * Uses the REST API directly (no `gh` binary dependency) so the steps run on
 * every runner image — the Appium matrix includes the custom iOS runner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { request } from "node:https";
import type { ChangedFile } from "./model.ts";

const API_HOST = "api.github.com";

const isRepoChar = (char: string): boolean =>
	(char >= "a" && char <= "z") ||
	(char >= "A" && char <= "Z") ||
	(char >= "0" && char <= "9") ||
	char === "-" ||
	char === "_" ||
	char === ".";

/** `owner/name` — anything else would smuggle path or query components. */
function assertRepoName(repo: string): void {
	const parts = repo.split("/");
	const valid =
		parts.length === 2 &&
		parts.every(
			(part) => part.length > 0 && [...part].every((char) => isRepoChar(char)),
		);
	if (!valid) throw new Error(`Invalid repository name: ${repo}`);
}

interface HttpResult {
	status: number;
	body: Buffer;
}

/**
 * GET over node:https with a fixed API hostname — the request target is
 * always `api.github.com` plus a server-relative path, and redirects are
 * followed explicitly. Artifact downloads redirect to GitHub's signed CDN
 * URL; that URL carries its own auth, so the API token is never forwarded
 * to a redirected host.
 */
function httpsGet(url: URL, token: string | null, depth: number): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: url.hostname,
				path: `${url.pathname}${url.search}`,
				method: "GET",
				headers: {
					...(token === null ? {} : { Authorization: `Bearer ${token}` }),
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
					"User-Agent": "bible-on-site-e2e-impact",
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("error", reject);
				response.on("end", () => {
					const status = response.statusCode ?? 0;
					const location = response.headers.location;
					if (status >= 300 && status < 400 && location !== undefined) {
						if (depth >= 5) {
							reject(new Error(`Too many redirects for ${url.pathname}`));
							return;
						}
						const target = new URL(location, url);
						if (target.protocol !== "https:") {
							reject(new Error(`Refusing non-https redirect: ${location}`));
							return;
						}
						resolve(httpsGet(target, null, depth + 1));
						return;
					}
					resolve({ status, body: Buffer.concat(chunks) });
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

async function apiGet(path: string, token: string): Promise<Buffer> {
	const url = new URL(path, `https://${API_HOST}`);
	if (url.hostname !== API_HOST) {
		throw new Error(`Refusing API host ${url.hostname}`);
	}
	const result = await httpsGet(url, token, 0);
	if (result.status < 200 || result.status >= 300) {
		throw new Error(`GitHub API ${result.status} for ${path}: ${result.body.toString("utf8")}`);
	}
	return result.body;
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
	assertRepoName(repo);
	const body = JSON.parse(
		(await apiGet(
			`/repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}`,
			token,
		)).toString("utf8"),
	) as {
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
	assertRepoName(repo);
	const zip = await apiGet(
		`/repos/${repo}/actions/artifacts/${artifact.id}/zip`,
		token,
	);
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
	assertRepoName(repo);
	const body = JSON.parse(
		(await apiGet(
			`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
			token,
		)).toString("utf8"),
	) as {
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
