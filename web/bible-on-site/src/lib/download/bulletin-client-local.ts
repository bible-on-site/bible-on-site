import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BulletinRequest } from "./bulletin-client";

function getBulletinBinaryPath(): string {
	const bulletinDir = resolve(process.cwd(), "../bulletin");
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

export function invokeBulletinBinary(request: BulletinRequest): Uint8Array {
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
			`Bulletin binary returned ${result.length} bytes - expected a PDF`,
		);
	}

	return new Uint8Array(result);
}
