import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import getPort from "get-port";
import packageJson from "../package.json" with { type: "json" };
import { standaloneAppDir } from "./standalone-app-dir.mjs";

const website = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
// The traced app nests under .next/standalone/<package-dir>/ since
// turbopack.root widened to web/ for the shared contracts (#3710).
const appDir = standaloneAppDir(website);

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
const compressed = path.join(appDir, `${canonicalFile}.br`);
const decompressed = brotliDecompressSync(readFileSync(compressed));
const standalone = {
	bytes: decompressed.length,
	sha256: createHash("sha256").update(decompressed).digest("hex"),
	compressedBytes: (await stat(compressed)).size,
};
if (
	original.bytes !== standalone.bytes ||
	original.sha256 !== standalone.sha256
)
	throw new Error(
		"Standalone canonical data differs from the original source bytes",
	);
// The warm-up artifact must be traced into the standalone layout and bound
// to exactly the corpus bytes the server hashes at boot (#2997): a missing or
// stale artifact silently downgrades cold starts to live computation.
const derivedFile = "src/data/db/warm-derived.generated.json.br";
const derived = JSON.parse(
	brotliDecompressSync(readFileSync(path.join(appDir, derivedFile))).toString(
		"utf8",
	),
);
const corpusBrSha256 = createHash("sha256")
	.update(readFileSync(compressed))
	.digest("hex");
if (derived.corpusSha256 !== corpusBrSha256)
	throw new Error(
		"Warm-derived artifact is stale relative to the standalone corpus",
	);
if (
	derived.perakim?.length !== 929 ||
	!(derived.pesukim?.length >= 20000) ||
	!derived.recitations?.length
)
	throw new Error("Warm-derived artifact is incomplete");
const largest = await largestJavaScript(path.join(appDir, ".next/server"));
console.log(
	JSON.stringify({
		canonicalStandalone: standalone,
		largestServerJavaScript: largest,
	}),
);
if (largest.bytes >= original.bytes)
	throw new Error(
		"Production server JavaScript still contains a canonical-data-sized payload",
	);

const port = await getPort({ host: "127.0.0.1" });
const server = spawn(process.execPath, [path.join(appDir, "server.js")], {
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
