import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export const recordingsKey = "RECITATION_RECORDINGS_PATH";
const repoDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const defaultAppDirectory = path.join(repoDirectory, "app", "BibleOnSite");

export function resolveRecordingsPath({
	appDirectory = defaultAppDirectory,
	env = process.env,
	userHome = os.homedir(),
} = {}) {
	const envFile = path.resolve(appDirectory, "..", ".dev.env.local");
	// CLI-only developer settings: a fixed filename under the selected app checkout.
	const settings = fs.existsSync(envFile) // nosemgrep
		? parseEnv(fs.readFileSync(envFile, "utf8")) // nosemgrep
		: {};
	const selected =
		env[recordingsKey] ||
		settings[recordingsKey] ||
		path.join(userHome, "git", "tanah-s3", "recordings");
	return path.resolve(appDirectory, "..", "..", selected);
}

function validateDirectory(directory) {
	if (
		/[\r\n]/u.test(directory) ||
		!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() // nosemgrep - The developer selects an arbitrary local audio directory.
	) {
		throw new Error(
			`Recordings directory does not exist: ${directory}. Run node devops/local-recitation.mjs configure or set ${recordingsKey}.`,
		);
	}
	return directory;
}

export async function configureRecordings({
	appDirectory = defaultAppDirectory,
	env = process.env,
	userHome = os.homedir(),
	prompt,
} = {}) {
	const current = resolveRecordingsPath({ appDirectory, env, userHome });
	let answer = "";
	if (prompt) {
		answer = await prompt(
			`Local recitation recordings directory [${current}]: `,
		);
	} else if (process.stdin.isTTY && process.stdout.isTTY) {
		const terminal = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			answer = await terminal.question(
				`Local recitation recordings directory [${current}]: `,
			);
		} finally {
			terminal.close();
		}
	}
	const selected = validateDirectory(
		answer.trim()
			? path.resolve(appDirectory, "..", "..", answer.trim())
			: current,
	);
	const envFile = path.resolve(appDirectory, "..", ".dev.env.local");
	// CLI-only configuration writes use the fixed ignored filename in this checkout.
	const existing = fs.existsSync(envFile) // nosemgrep
		? fs.readFileSync(envFile, "utf8") // nosemgrep
		: "";
	// Forward slashes work on Windows and avoid dotenv's backslash escapes.
	const assignment = `${recordingsKey}=${JSON.stringify(selected.replace(/\\/g, "/"))}`;
	const pattern = /^\s*(?:export\s+)?RECITATION_RECORDINGS_PATH\s*=.*$/gm;
	const updated = pattern.test(existing)
		? existing.replace(pattern, () => assignment)
		: `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${assignment}\n`;
	fs.mkdirSync(path.dirname(envFile), { recursive: true }); // nosemgrep
	fs.writeFileSync(envFile, updated); // nosemgrep
	console.info(`Local recordings configured: ${selected}`);
	return selected;
}

export function prepareRecitation({
	platform,
	appDirectory = defaultAppDirectory,
	recordings,
	env = process.env,
	run = spawnSync,
} = {}) {
	if (!["Android", "iOS", "Windows"].includes(platform)) {
		throw new Error("Recitation platform must be Android, iOS or Windows.");
	}
	const project = path.resolve(appDirectory, "..", "..");
	const source = validateDirectory(
		recordings
			? path.resolve(project, recordings)
			: resolveRecordingsPath({ appDirectory, env }),
	);
	const result = run(
		env.PYTHON || (process.platform === "win32" ? "python" : "python3"),
		[
			path.join(project, "app", "devops", "prepare_recitation_assets.py"),
			"--local-originals",
			"--platform",
			platform,
			"--app-directory",
			appDirectory,
			"--recordings",
			source,
		],
		{ cwd: project, env, stdio: "inherit" },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`Recitation preparation failed (exit ${result.status}).`);
	}
}

async function main() {
	const command = process.argv[2];
	const { values } = parseArgs({
		args: process.argv.slice(3),
		options: {
			platform: { type: "string", default: "Android" },
			"app-directory": { type: "string" },
			recordings: { type: "string" },
		},
	});
	const appDirectory = path.resolve(
		values["app-directory"] || defaultAppDirectory,
	);
	if (command === "configure") {
		await configureRecordings({
			appDirectory,
			env: values.recordings
				? { ...process.env, [recordingsKey]: values.recordings }
				: process.env,
		});
	} else if (command === "prepare") {
		prepareRecitation({
			platform: values.platform,
			appDirectory,
			recordings: values.recordings,
		});
	} else {
		throw new Error(
			"Usage: node devops/local-recitation.mjs configure|prepare [--recordings PATH] [--platform Android|iOS|Windows]",
		);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
