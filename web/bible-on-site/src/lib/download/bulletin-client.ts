/**
 * Client for the bulletin PDF generation service (web/bulletin).
 *
 * In production: invokes the Lambda directly via AWS SDK (BULLETIN_LAMBDA_NAME).
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

/** Shape expected by the bulletin service (camelCase — matches Rust serde config). */
interface BulletinRequest {
	perakimIds: number[];
	includePerushim: boolean;
	includeArticles: boolean;
	articleIds: number[];
	authorIds: number[];
}

function getBulletinLambdaName(): string | undefined {
	return process.env.BULLETIN_LAMBDA_NAME;
}

/**
 * Invoke the bulletin Lambda via AWS SDK.
 * The ECS task role must have lambda:InvokeFunction permission.
 * The Lambda receives an API Gateway-style event (POST /api/generate-pdf)
 * and returns a response with base64-encoded PDF in the body.
 */
async function invokeBulletinLambda(
	functionName: string,
	request: BulletinRequest,
): Promise<Uint8Array> {
	const { LambdaClient, InvokeCommand } = await import(
		"@aws-sdk/client-lambda"
	);
	const client = new LambdaClient({});

	const lambdaEvent = {
		httpMethod: "POST",
		path: "/api/generate-pdf",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(request),
		isBase64Encoded: false,
	};

	const command = new InvokeCommand({
		FunctionName: functionName,
		Payload: Buffer.from(JSON.stringify(lambdaEvent)),
	});

	const result = await client.send(command);

	if (result.FunctionError) {
		const errMsg = result.Payload
			? Buffer.from(result.Payload).toString("utf-8")
			: "unknown";
		throw new Error(`Bulletin Lambda error: ${errMsg}`);
	}

	if (!result.Payload) {
		throw new Error("Bulletin Lambda returned empty payload");
	}

	const response = JSON.parse(
		Buffer.from(result.Payload).toString("utf-8"),
	);

	if (response.statusCode !== 200) {
		throw new Error(
			`Bulletin Lambda returned status ${response.statusCode}: ${response.body ?? ""}`,
		);
	}

	const pdfBytes = response.isBase64Encoded
		? Buffer.from(response.body, "base64")
		: Buffer.from(response.body, "binary");

	if (pdfBytes.length < 5) {
		throw new Error(
			`Bulletin Lambda returned ${pdfBytes.length} bytes — expected a PDF`,
		);
	}

	return new Uint8Array(pdfBytes);
}

/**
 * Resolve the path to the bulletin binary.
 * Only used in dev mode (BULLETIN_LAMBDA_NAME is not set).
 */
function getBulletinBinaryPath(): string {
	const bulletinDir = resolve(
		process.cwd(),
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
 * Routes to Lambda (production) or local binary (dev) based on BULLETIN_LAMBDA_NAME.
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

	const lambdaName = getBulletinLambdaName();
	if (lambdaName) {
		return invokeBulletinLambda(lambdaName, request);
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
