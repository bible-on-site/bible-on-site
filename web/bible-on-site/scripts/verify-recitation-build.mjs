import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getPort from "get-port";
import packageJson from "../package.json" with { type: "json" };

const website = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
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
