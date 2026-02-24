/**
 * Client for the bulletin PDF generation service (web/bulletin).
 *
 * In production: calls the bulletin Lambda via its Function URL (BULLETIN_SERVICE_URL).
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

function getBulletinServiceUrl(): string | undefined {
	return process.env.BULLETIN_SERVICE_URL;
}

/**
 * Invoke the bulletin service via its HTTP endpoint (Lambda Function URL).
 * POST /api/generate-pdf with JSON body → PDF binary response.
 */
async function invokeBulletinLambda(
	serviceUrl: string,
	request: BulletinRequest,
): Promise<Uint8Array> {
	const url = `${serviceUrl}/api/generate-pdf`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`Bulletin service returned ${response.status}: ${text}`,
		);
	}

	const buf = await response.arrayBuffer();
	if (buf.byteLength < 5) {
		throw new Error(
			`Bulletin service returned ${buf.byteLength} bytes — expected a PDF`,
		);
	}

	return new Uint8Array(buf);
}

/**
 * Resolve the path to the bulletin binary.
 * Only used in dev mode (BULLETIN_SERVICE_URL is not set).
 */
function getBulletinBinaryPath(): string {
	const bulletinDir = resolve(
		process.cwd(),
		// From web/bible-on-site → web/bulletin
		"../bulletin",
	);

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
 * Invoke the bulletin binary as a subprocess (dev mode).
 * Passes the request as JSON on stdin, reads PDF bytes from stdout.
 */
function invokeBulletinBinary(request: BulletinRequest): Uint8Array {
	const binaryPath = getBulletinBinaryPath();
	const input = JSON.stringify(request);

	const result = execFileSync(binaryPath, [], {
		input,
		maxBuffer: 50 * 1024 * 1024,
		env: {
			...process.env,
			RUST_LOG: process.env.RUST_LOG ?? "warn",
		},
		timeout: 30_000,
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
 * Routes to Lambda (production) or local binary (dev) based on BULLETIN_SERVICE_URL.
 */
export async function generatePdfViaBulletin(
	perekIds: number[],
): Promise<Uint8Array> {
	const request: BulletinRequest = {
		perakimIds: perekIds,
		includePerushim: false,
		includeArticles: true,
		articleIds: [],
		authorIds: [],
	};

	const serviceUrl = getBulletinServiceUrl();
	if (serviceUrl) {
		return invokeBulletinLambda(serviceUrl, request);
	}
	return invokeBulletinBinary(request);
}

/**
 * Create a page-ranges download handler that invokes the bulletin service.
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

		const bin = await generatePdfViaBulletin(perekIds);
		return ["pdf", bin];
	};
}
