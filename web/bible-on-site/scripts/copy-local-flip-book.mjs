/** Refresh the optional local flip-book build without changing the published dependency. */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readPackage(directory) {
	return JSON.parse(
		fs.readFileSync(path.join(directory, "package.json"), "utf8"),
	);
}

// The integration pins exact releases. Unknown version formats need an explicit
// opt-in rather than silently replacing a published release with older code.
function versionParts(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(version ?? "");
	return match
		? [
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
				match[4] == null ? Infinity : Number(match[4]),
			]
		: null;
}

function atLeastVersion(localVersion, publishedVersion) {
	const local = versionParts(localVersion);
	const published = versionParts(publishedVersion);
	if (!local || !published) return false;
	for (let i = 0; i < local.length; i++) {
		if (local[i] !== published[i]) return local[i] > published[i];
	}
	return true;
}

function activeLocalRepository(projectRoot, env) {
	if (env.USE_LOCAL_FLIP_BOOK === "0") return null;
	const marker = path.join(
		projectRoot,
		"node_modules",
		"html-flip-book-react",
		".local-flip-book",
	);
	if (!fs.existsSync(marker)) return null;
	const { repoRoot } = JSON.parse(fs.readFileSync(marker, "utf8"));
	if (typeof repoRoot !== "string" || !repoRoot.trim())
		throw new Error(`Invalid active local flip-book marker: ${marker}`);
	return path.resolve(repoRoot);
}

export function resolveLocalFlipBook(
	projectRoot,
	env = process.env,
	automatic = false,
) {
	const dep = readPackage(projectRoot).dependencies?.["html-flip-book-react"];
	const fileDependency = dep?.startsWith("file:");
	const activeRepo = fileDependency
		? null
		: activeLocalRepository(projectRoot, env);
	const explicit =
		fileDependency || env.USE_LOCAL_FLIP_BOOK === "1" || activeRepo !== null;
	if (!explicit && (!automatic || env.USE_LOCAL_FLIP_BOOK === "0")) return null;
	const repoDir =
		activeRepo ?? path.resolve(projectRoot, "..", "..", "..", "html-flip-book");
	const reactSrc = fileDependency
		? path.resolve(projectRoot, dep.slice("file:".length))
		: ["react", "html-flip-book-react"]
				.map((name) => path.join(repoDir, name))
				.find((candidate) =>
					fs.existsSync(path.join(candidate, "package.json")),
				);
	if (!reactSrc || !fs.existsSync(path.join(reactSrc, "package.json"))) {
		if (explicit)
			throw new Error(
				`Local flip-book package is missing under ${reactSrc ?? repoDir}`,
			);
		return null;
	}
	const version = readPackage(reactSrc).version;
	if (!explicit && !atLeastVersion(version, dep)) {
		console.warn(
			`predev-deps: keeping published flip-book ${dep}; local ${version} at ${reactSrc} is older or cannot be compared. Set USE_LOCAL_FLIP_BOOK=1 to use that checkout intentionally.`,
		);
		return null;
	}
	const repoRoot = path.dirname(reactSrc);
	const baseSrc = ["base", "html-flip-book-base", "vanilla"]
		.map((name) => path.join(repoRoot, name))
		.find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
	if (!baseSrc)
		throw new Error(
			`Local flip-book base package is missing under ${repoRoot}`,
		);
	return { reactSrc, baseSrc, repoRoot, version };
}

function digestFiles(directory, entries) {
	const hash = createHash("sha256");
	function visit(relative) {
		const full = path.join(directory, relative);
		if (!fs.existsSync(full)) return;
		if (fs.statSync(full).isDirectory()) {
			for (const name of fs.readdirSync(full).sort()) {
				if (name !== "__tests__" && !/\.(test|spec)\./.test(name))
					visit(path.join(relative, name));
			}
		} else {
			hash.update(relative);
			hash.update("\0");
			hash.update(fs.readFileSync(full));
		}
	}
	for (const entry of entries.sort()) visit(entry);
	return hash.digest("hex");
}

function buildInputs(local) {
	const rootFiles = fs
		.readdirSync(local.repoRoot)
		.filter((name) =>
			/^(package\.json|(?:bun|package)\.lock(?:b)?|package-lock\.json|(?:vite|tsconfig)[^/]*\.(?:[cm]?[jt]s|json))$/.test(
				name,
			),
		);
	return digestFiles(local.repoRoot, [
		...rootFiles,
		"scripts",
		"bunfig.toml",
		...[local.baseSrc, local.reactSrc].flatMap((directory) => {
			const relative = path.relative(local.repoRoot, directory);
			return [
				path.join(relative, "src"),
				...fs
					.readdirSync(directory)
					.filter((name) => /^(package\.json|tsconfig[^/]*\.json)$/.test(name))
					.map((name) => path.join(relative, name)),
			];
		}),
	]);
}

function outputFiles(local) {
	return [local.baseSrc, local.reactSrc].map((directory) =>
		path.join(path.relative(local.repoRoot, directory), "dist"),
	);
}

function validateBuild(local) {
	for (const directory of [local.baseSrc, local.reactSrc]) {
		const pkg = readPackage(directory);
		const files = new Set([pkg.main, pkg.types]);
		function collect(value) {
			if (typeof value === "string") files.add(value);
			else if (value && typeof value === "object")
				Object.values(value).forEach(collect);
		}
		collect(pkg.exports);
		for (const file of files) {
			if (
				file?.startsWith("./dist/") &&
				!fs.existsSync(path.resolve(directory, file))
			) {
				throw new Error(
					`Local flip-book build is incomplete: ${path.resolve(directory, file)}`,
				);
			}
		}
	}
}

/** Only retire snapshots created directly inside this checkout's node_modules. */
export function getLocalSnapshotDirectory(target) {
	const modules = path.dirname(path.resolve(target));
	const build = fs.existsSync(target) ? fs.realpathSync(target) : null;
	const snapshot = build ? path.dirname(build) : null;
	return snapshot &&
		path.dirname(snapshot) === modules &&
		path.basename(snapshot).startsWith(".flip-book-local-") &&
		path.basename(build) === "next"
		? snapshot
		: null;
}

export function copyLocalFlipBook(
	projectRoot,
	{
		env = process.env,
		local = resolveLocalFlipBook(projectRoot, env),
		run = execSync,
		platform = process.platform,
	} = {},
) {
	if (!local) return false;
	const stampPath = path.join(
		local.repoRoot,
		"node_modules",
		".bible-on-site-build-stamp",
	);
	const inputs = buildInputs(local);
	const outputs = digestFiles(local.repoRoot, outputFiles(local));
	const expectedStamp = JSON.stringify({ inputs, outputs });
	if (
		!fs.existsSync(stampPath) ||
		fs.readFileSync(stampPath, "utf8") !== expectedStamp
	) {
		console.log(
			`copy-local-flip-book: building local ${local.version} at ${local.repoRoot}`,
		);
		run("bun run build", { cwd: local.repoRoot, stdio: "inherit", env });
		validateBuild(local);
		fs.mkdirSync(path.dirname(stampPath), { recursive: true });
		fs.writeFileSync(
			stampPath,
			JSON.stringify({
				inputs,
				outputs: digestFiles(local.repoRoot, outputFiles(local)),
			}),
		);
	} else {
		validateBuild(local);
	}
	const target = path.resolve(
		projectRoot,
		"node_modules",
		"html-flip-book-react",
	);
	const previousVanilla = path.join(
		target,
		"node_modules",
		"html-flip-book-vanilla",
	);
	const markerPath = path.join(target, ".local-flip-book");
	const marker = JSON.stringify({
		repoRoot: local.repoRoot,
		build: fs.readFileSync(stampPath, "utf8"),
	});
	if (
		fs.existsSync(markerPath) &&
		fs.readFileSync(markerPath, "utf8") === marker
	) {
		try {
			validateBuild({ baseSrc: previousVanilla, reactSrc: target });
			console.log(
				`copy-local-flip-book: local ${local.version} unchanged — skipping copy`,
			);
			return true;
		} catch {
			// Repair an incomplete installed copy from the validated local build.
		}
	}

	// Build and stage the complete replacement first. Failed builds/installs leave
	// the installed registry package (or previous working local copy) usable.
	const modules = path.resolve(projectRoot, "node_modules");
	fs.mkdirSync(modules, { recursive: true });
	const staging = fs.mkdtempSync(path.join(modules, ".flip-book-local-"));
	if (path.dirname(staging) !== modules)
		throw new Error("Unexpected flip-book staging path");
	const next = path.join(staging, "next");
	const previous = path.join(staging, "previous");
	const vanilla = path.join(next, "node_modules", "html-flip-book-vanilla");
	const previousSnapshot = getLocalSnapshotDirectory(target);
	let installed = false;
	let retainBackup = false;
	try {
		fs.mkdirSync(vanilla, { recursive: true });
		for (const [source, destination] of [
			[local.reactSrc, next],
			[local.baseSrc, vanilla],
		]) {
			fs.copyFileSync(
				path.join(source, "package.json"),
				path.join(destination, "package.json"),
			);
			fs.cpSync(path.join(source, "dist"), path.join(destination, "dist"), {
				recursive: true,
			});
		}
		if (
			fs.existsSync(path.join(previousVanilla, "node_modules")) &&
			JSON.stringify(readPackage(previousVanilla).dependencies) ===
				JSON.stringify(readPackage(local.baseSrc).dependencies)
		) {
			fs.cpSync(
				path.join(previousVanilla, "node_modules"),
				path.join(vanilla, "node_modules"),
				{ recursive: true },
			);
		} else {
			run("bun install --production", { cwd: vanilla, stdio: "inherit", env });
		}
		fs.writeFileSync(path.join(next, ".local-flip-book"), marker);
		// Windows scanners/watchers can hold freshly copied files without delete
		// sharing. Publish a junction to the complete snapshot: promotion then
		// renames only the link, never the newly copied directory tree.
		const replacement =
			platform === "win32" ? path.join(staging, "link") : next;
		if (platform === "win32") fs.symlinkSync(next, replacement, "junction");
		if (
			fs.existsSync(target) ||
			fs.lstatSync(target, { throwIfNoEntry: false })
		)
			fs.renameSync(target, previous);
		try {
			fs.renameSync(replacement, target);
			installed = true;
		} catch (error) {
			try {
				if (fs.existsSync(previous)) fs.renameSync(previous, target);
			} catch (rollbackError) {
				retainBackup = true;
				throw new AggregateError(
					[error, rollbackError],
					`Local flip-book rollback failed; previous package retained at ${previous}`,
				);
			}
			throw error;
		}
	} finally {
		// mkdtemp created this absolute directory directly inside this checkout's
		// node_modules; recursive cleanup cannot escape through a computed path.
		if (!retainBackup) {
			if (installed && platform === "win32") {
				fs.rmSync(previous, { recursive: true, force: true });
				if (previousSnapshot && previousSnapshot !== staging)
					fs.rmSync(previousSnapshot, { recursive: true, force: true });
			} else fs.rmSync(staging, { recursive: true, force: true });
		}
	}
	console.log(
		`copy-local-flip-book: using local ${local.version} from ${local.repoRoot}`,
	);
	return true;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		copyLocalFlipBook(
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
		);
	} catch (error) {
		console.error("copy-local-flip-book:", error.message);
		process.exitCode = 1;
	}
}
