/**
 * Client for the bulletin PDF generation service (web/bulletin).
 *
 * In production: invokes the AWS Lambda via BULLETIN_LAMBDA_ARN.
 * In dev: spawns the Rust binary as a subprocess (on-demand, like Lambda).
 *
 * The binary reads JSON from stdin and writes PDF bytes to stdout.
 * Each invocation is independent — no persistent server.
 *
 * Request is just perek IDs — the Lambda resolves all data
 * (text, headers, sefer name) from its embedded Tanach data.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { SemanticPageInfo } from "./types";
import { semanticPagesToPerekIds } from "./tanach-pdf";

/** Shape expected by the bulletin service. */
interface BulletinRequest {
	perakimIds: number[];
	includePerushim: boolean;
	includeArticles: boolean;
	articleIds: number[];
	authorIds: number[];
}

/**
 * Resolve the path to the bulletin binary.
 * In dev: compiled Rust binary in web/bulletin/target/
 * In prod: this function is not called (Lambda is invoked instead).
 */
function getBulletinBinaryPath(): string {
	const bulletinDir = resolve(
		process.cwd(),
		// From web/bible-on-site → web/bulletin
		"../bulletin",
	);

	// Try release build first, then debug
	const candidates = [
		resolve(bulletinDir, "target/release/bulletin"),
		resolve(bulletinDir, "target/release/bulletin.exe"),
		resolve(bulletinDir, "target/debug/bulletin"),
		resolve(bulletinDir, "target/debug/bulletin.exe"),
	];

	for (const path of candidates) {
		if (existsSync(path)) return path;
	}

	throw new Error(
		"Bulletin binary not found. Build it first:\n  cd web/bulletin && cargo build --release\n" +
			`Searched: ${candidates.join(", ")}`,
	);
}

/**
 * Invoke the bulletin binary as a subprocess.
 * Passes the request as JSON on stdin, reads PDF bytes from stdout.
 */
function invokeBulletinBinary(request: BulletinRequest): Uint8Array {
	const binaryPath = getBulletinBinaryPath();
	const input = JSON.stringify(request);

	const result = execFileSync(binaryPath, [], {
		input,
		// PDF bytes can be large — 50MB should be more than enough
		maxBuffer: 50 * 1024 * 1024,
		env: {
			...process.env,
			// Ensure logging goes to stderr, not stdout
			RUST_LOG: process.env.RUST_LOG ?? "warn",
		},
		timeout: 30_000, // 30s — matches Lambda timeout
	});

	if (result.length < 5) {
		throw new Error(
			`Bulletin binary returned ${result.length} bytes — expected a PDF`,
		);
	}

	return new Uint8Array(result);
}

/**
 * Generate a PDF for the given perek IDs.
 * Returns raw PDF bytes.
 */
export function generatePdfViaBulletin(perekIds: number[]): Uint8Array {
	const request: BulletinRequest = {
		perakimIds: perekIds,
		includePerushim: false,
		includeArticles: true,
		articleIds: [],
		authorIds: [],
	};

	return invokeBulletinBinary(request);
}

/**
 * Create a page-ranges download handler that invokes the bulletin binary.
 * Drop-in replacement for the pdf-lib based handler.
 */
export function createBulletinPageRangesHandler(): (
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: { seferName?: string },
) => Promise<[ext: string, bin: Uint8Array]> {
	return async (_pages, semanticPages, context) => {
		const seferName = context?.seferName;
		if (!seferName) {
			throw new Error("Tanach PDF requires context.seferName");
		}

		const perekIds = semanticPagesToPerekIds(semanticPages, seferName);
		if (perekIds.length === 0) {
			throw new Error("No content pages in selected range");
		}

		const bin = generatePdfViaBulletin(perekIds);
		return ["pdf", bin];
	};
}
