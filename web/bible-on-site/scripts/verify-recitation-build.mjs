import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getPort from "get-port";
import packageJson from "../package.json" with { type: "json" };

const website = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

async function fingerprint(file) {
	const hash = createHash("sha256");
	let bytes = 0;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		bytes += chunk.length;
	}
	return { bytes, sha256: hash.digest("hex") };
}

async function largestJavaScript(directory) {
	let largest = { file: "", bytes: 0 };
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		const candidate = entry.isDirectory()
			? await largestJavaScript(file)
			: entry.isFile() && entry.name.endsWith(".js")
				? { file: path.relative(website, file), bytes: (await stat(file)).size }
				: { file: "", bytes: 0 };
		if (candidate.bytes > largest.bytes) largest = candidate;
	}
	return largest;
}

const canonicalFile = "src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json";
const original = await fingerprint(path.join(website, canonicalFile));
const standalone = await fingerprint(path.join(website, ".next/standalone", canonicalFile));
if (original.bytes !== standalone.bytes || original.sha256 !== standalone.sha256)
	throw new Error("Standalone canonical data differs from the original source bytes");
const largest = await largestJavaScript(path.join(website, ".next/standalone/.next/server"));
console.log(JSON.stringify({ canonicalStandalone: standalone, largestServerJavaScript: largest }));
if (largest.bytes >= original.bytes)
	throw new Error("Production server JavaScript still contains a canonical-data-sized payload");

const port = await getPort({ host: "127.0.0.1" });
const server = spawn(process.execPath, [".next/standalone/server.js"], {
	cwd: website,
	env: {
		...process.env,
		NODE_ENV: "production",
		HOSTNAME: "127.0.0.1",
		PORT: String(port),
	},
	stdio: "inherit",
});
server.on("error", (error) => {
	console.error(error);
	process.exitCode = 1;
});

try {
	const verifier = spawn(
		process.env.RECITATION_PYTHON || "python",
		[
			"../../data/recitation/deployment.py",
			"--origin",
			`http://127.0.0.1:${port}`,
			"--version",
			packageJson.version,
			"--attempts",
			"12",
			"--interval",
			"1",
		],
		{ cwd: website, stdio: "inherit", timeout: 120_000 },
	);
	await new Promise((resolve, reject) => {
		verifier.on("error", reject);
		verifier.on("exit", (code, signal) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(`Recitation build verification failed (${signal || code})`),
				);
		});
	});
} finally {
	server.kill();
}
