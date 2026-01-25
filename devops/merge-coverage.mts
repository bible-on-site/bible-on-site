import fs from "node:fs"; // Import the 'fs' module
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = dirname(__filename); // get the name of the directory
const websiteCoverageDir = resolve(
	__dirname,
	"../web/bible-on-site/.coverage/merged",
);
const websiteCoverageFilePath = resolve(
	__dirname,
	websiteCoverageDir,
	"lcov.info",
);
const apiCoverageDir = resolve(__dirname, "../web/api/.coverage/merged");
const apiCoverageFilePath = resolve(apiCoverageDir, "lcov.info");
const adminCoverageDir = resolve(__dirname, "../web/admin/.coverage/merged");
const adminCoverageFilePath = resolve(adminCoverageDir, "lcov.info");
const appCoverageDir = resolve(__dirname, "../app/.coverage/merged");
const appCoverageFilePath = resolve(appCoverageDir, "lcov.info");
const outputDir = resolve(__dirname, "..", ".coverage");
const outputFilePath = resolve(outputDir, "lcov.info");

try {
	fs.mkdirSync(outputDir);
} catch (e) {
	if ((e as { code: string }).code !== "EEXIST") throw e;
}

const stream = fs.createWriteStream(outputFilePath);
stream.write(await fs.promises.readFile(websiteCoverageFilePath));
stream.write(await fs.promises.readFile(apiCoverageFilePath));

// Admin coverage is optional - only include if the file exists
if (fs.existsSync(adminCoverageFilePath)) {
	stream.write(await fs.promises.readFile(adminCoverageFilePath));
	await fs.promises.rm(adminCoverageDir, { recursive: true });
}

// App coverage is optional - only include if the file exists
if (fs.existsSync(appCoverageFilePath)) {
	stream.write(await fs.promises.readFile(appCoverageFilePath));
	await fs.promises.rm(appCoverageDir, { recursive: true });
}

stream.end();

await fs.promises.rm(websiteCoverageDir, { recursive: true });
await fs.promises.rm(apiCoverageDir, { recursive: true });
