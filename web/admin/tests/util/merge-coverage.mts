import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "../..");

const COVERAGE_DIR = resolve(projectRoot, ".coverage");
const UNIT_LCOV = resolve(COVERAGE_DIR, "unit/lcov.info");
const E2E_LCOV = resolve(COVERAGE_DIR, "e2e/lcov.info");
const MERGED_DIR = resolve(COVERAGE_DIR, "merged");
const MERGED_LCOV = resolve(MERGED_DIR, "lcov.info");

// Create merged directory if it doesn't exist
mkdirSync(MERGED_DIR, { recursive: true });

const stream = createWriteStream(MERGED_LCOV);
let hasContent = false;

// Merge unit coverage if exists
if (existsSync(UNIT_LCOV)) {
	const content = readFileSync(UNIT_LCOV, "utf8");
	stream.write(content);
	hasContent = true;
	console.log(`✓ Added unit coverage from ${UNIT_LCOV}`);
} else {
	console.log(`⚠ Unit coverage not found at ${UNIT_LCOV}`);
}

// Merge E2E coverage if exists
if (existsSync(E2E_LCOV)) {
	const content = readFileSync(E2E_LCOV, "utf8");
	stream.write(content);
	hasContent = true;
	console.log(`✓ Added E2E coverage from ${E2E_LCOV}`);
} else {
	console.log(`⚠ E2E coverage not found at ${E2E_LCOV}`);
}

stream.end();

if (hasContent) {
	console.log(`\n✓ Merged coverage written to ${MERGED_LCOV}`);
} else {
	console.log("\n⚠ No coverage files found to merge");
}
