import fs from "node:fs"; // Import the 'fs' module
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const websiteCoverageDir = path.resolve(
	__dirname,
	"../web/bible-on-site/.coverage/merged",
);
const websiteCoverageFilePath = path.resolve(
	__dirname,
	websiteCoverageDir,
	"lcov.info",
);
const apiCoverageDir = path.resolve(__dirname, "../web/api/.coverage/merged");
const apiCoverageFilePath = path.resolve(apiCoverageDir, "lcov.info");
const appCoverageDir = path.resolve(__dirname, "../app/.coverage/merged");
const appCoverageFilePath = path.resolve(appCoverageDir, "lcov.info");
const outputDir = path.resolve(__dirname, "..", ".coverage");
const outputFilePath = path.resolve(outputDir, "lcov.info");

try {
	fs.mkdirSync(outputDir);
} catch (e) {
	if ((e as { code: string }).code !== "EEXIST") throw e;
}

const stream = fs.createWriteStream(outputFilePath);
stream.write(await fs.promises.readFile(websiteCoverageFilePath));
stream.write(await fs.promises.readFile(apiCoverageFilePath));

// App coverage is optional - only include if the file exists
if (fs.existsSync(appCoverageFilePath)) {
	stream.write(await fs.promises.readFile(appCoverageFilePath));
	await fs.promises.rm(appCoverageDir, { recursive: true });
}

stream.end();

await fs.promises.rm(websiteCoverageDir, { recursive: true });
await fs.promises.rm(apiCoverageDir, { recursive: true });
