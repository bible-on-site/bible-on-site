#!/usr/bin/env node
/**
 * Hebrew store release notes for the app stores (#2972).
 *
 * Store-facing notes are consumer copy, not the developer changelog: curated
 * structured Hebrew entries under `app/store-release-notes/<id>.json` describe
 * each user-visible change once, at authoring time, in the audience's
 * language. At delivery time this module selects the entries each store
 * audience has not yet been told about and renders them to that store's size
 * limit.
 *
 * Baseline = the last successfully delivered version for the exact
 * store/channel, recovered from the GitHub deployment records the CD guard
 * already writes per target (`app-android`, `app-windows`, `app-ios-beta`).
 * A tag or a binary upload never advances a baseline (#2970); only a
 * successful deployment does, so skipped or half-failed versions stay inside
 * the announced range and already-announced features never repeat.
 *
 * Feature selection diffs the entry directory between the baseline tag and
 * the release tag: an entry is announced when it is enabled at the release
 * tag but was absent or disabled at the baseline tag. That covers features
 * first shipped in skipped versions, reverted work (the file is gone at the
 * tag), disabled work (`"enabled": false`), and enable-flips merged between
 * releases. Release tags are immutable, so every generation for the same
 * target/version is deterministic and reproducible.
 *
 * Usage:
 *   node store-release-notes.mjs --generate --target app-android \
 *     --version 5.1.8 --tag app-v5.1.8 --out-dir "$RUNNER_TEMP/store-notes"
 *   node store-release-notes.mjs --generate --target app-store-public \
 *     --version 5.1.8 --tag app-v5.1.8 --baseline-version 5.1.7 --dry-run
 *
 * `--out-dir` writes `release-notes.txt` (empty when the release predates
 * curated entries) and `release-notes-manifest.json`, the immutable record of
 * baseline, source tag, feature ids, rendered text and digest. `--dry-run`
 * prints the manifest without writing. An editorial override rides in
 * `STORE_NOTES_OVERRIDE` (validated like authored text) for corrections tied
 * to the exact release being deployed.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ghApi } from "./gh-api.mjs";

export const ENTRIES_DIR = "app/store-release-notes";

/**
 * Verified per-store release-notes limits (Unicode characters per language):
 * Google Play 500, App Store Connect (What's New + TestFlight) 4000,
 * Microsoft Store listing releaseNotes 1500. `app-store-public` has no
 * GitHub deployment environment — its baseline is the version Apple reports
 * READY_FOR_SALE, passed via `--baseline-version`.
 */
export const TARGETS = {
	"app-android": {
		platform: "android",
		environment: "app-android",
		limit: 500,
	},
	"app-ios-beta": {
		platform: "ios",
		environment: "app-ios-beta",
		limit: 4000,
	},
	"app-store-public": {
		platform: "ios",
		environment: null,
		limit: 4000,
	},
	"app-windows": {
		platform: "windows",
		environment: "app-windows",
		limit: 1500,
	},
};

export const PLATFORMS = ["android", "ios", "windows"];
export const KINDS = ["feature", "fix", "performance"];
const KIND_ORDER = { feature: 0, fix: 1, performance: 2 };

/** Honest no-user-visible-change copy — never claims invented features. */
export const MAINTENANCE_TEXT = "גרסה זו כוללת שיפורים פנימיים ותחזוקה.";

/** Authored bullets stay short of every store's rendering budget. */
export const ENTRY_TEXT_LIMIT = 240;

const ENTRY_ID = /^[a-z0-9][a-z0-9-]*\.json$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HEBREW_LETTER = /[א-ת]/;
// Authored Hebrew copy follows AGENTS.md: ASCII "-'` and digits/punctuation
// only — no Latin letters, maqaf/gershayim/geresh, typographic dashes or
// quotes, URLs, handles, issue numbers or developer prefixes.
const FORBIDDEN =
	/[A-Za-z]|־|׳|״|[—–‘’“”]|https?:\/\/|www\.|@|#\d|^\s*(feat|fix|perf|docs|chore|refactor|test|ci|build|style|revert)\b/im;

const runGit = (args, cwd) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	}).trim();

export function compareVersions(a, b) {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
	return 0;
}

/**
 * One curated user-visible change. Rejects anything that would leak English,
 * links or technical formatting into store copy.
 */
export function validateEntry(fileName, entry) {
	const fail = (reason) => {
		throw new Error(`Invalid store-notes entry ${fileName}: ${reason}`);
	};
	if (!ENTRY_ID.test(fileName)) fail("file name must be kebab-case .json");
	if (entry === null || typeof entry !== "object" || Array.isArray(entry))
		fail("entry must be a JSON object");
	for (const key of Object.keys(entry))
		if (!["text", "platforms", "kind", "enabled", "pr"].includes(key))
			fail(`unknown field "${key}"`);
	if (typeof entry.text !== "string" || !entry.text.trim())
		fail('"text" is required');
	const text = entry.text.trim();
	if (text.length > ENTRY_TEXT_LIMIT)
		fail(`"text" is ${text.length} chars, over the ${ENTRY_TEXT_LIMIT} limit`);
	if (!HEBREW_LETTER.test(text)) fail('"text" must contain Hebrew');
	if (FORBIDDEN.test(text))
		fail(
			'"text" must be plain Hebrew: no Latin letters, links, handles, issue numbers, maqaf/gershayim or typographic punctuation',
		);
	if (
		!Array.isArray(entry.platforms) ||
		entry.platforms.length === 0 ||
		new Set(entry.platforms).size !== entry.platforms.length ||
		!entry.platforms.every((p) => PLATFORMS.includes(p))
	)
		fail(`"platforms" must be a non-empty subset of ${PLATFORMS.join("/")}`);
	if (entry.kind !== undefined && !KINDS.includes(entry.kind))
		fail(`"kind" must be one of ${KINDS.join("/")}`);
	if (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
		fail('"enabled" must be boolean');
	if (
		entry.pr !== undefined &&
		(!Number.isSafeInteger(entry.pr) || entry.pr < 1)
	)
		fail('"pr" must be a positive pull request number');
	return {
		text,
		platforms: [...entry.platforms],
		kind: entry.kind ?? "feature",
		enabled: entry.enabled !== false,
		...(entry.pr !== undefined ? { pr: entry.pr } : {}),
	};
}

/**
 * The last version successfully delivered to this store/channel, from the
 * GitHub deployment records written by the CD deployment guard. A version
 * counts as delivered only when one of its deployments reached `success` —
 * an upload that failed before the release commit (#2970) never becomes a
 * baseline, and its features stay in the next delivery's range.
 */
export function resolveBaselineVersion({
	repo,
	environment,
	version,
	api = ghApi,
}) {
	if (!VERSION.test(version))
		throw new Error(`Invalid release version: ${version}`);
	const prefix = `${environment}-v`;
	const candidates = new Map();
	for (let page = 1; ; page++) {
		const deployments = api(
			`repos/${repo}/deployments?environment=${environment}&task=deploy:release&per_page=100&page=${page}`,
		);
		if (!Array.isArray(deployments))
			throw new Error("Invalid deployment history");
		for (const deployment of deployments) {
			const key = deployment.payload?.release_key;
			if (typeof key !== "string" || !key.startsWith(prefix)) continue;
			const delivered = key.slice(prefix.length);
			if (
				!VERSION.test(delivered) ||
				compareVersions(delivered, version) >= 0
			)
				continue;
			if (!candidates.has(delivered)) candidates.set(delivered, []);
			candidates.get(delivered).push(deployment.id);
		}
		if (deployments.length < 100) break;
	}
	for (const candidate of [...candidates.keys()].sort(compareVersions).reverse()) {
		// A version is delivered when any of its deployments succeeded. The
		// guard never opens a second deployment after success, so successes
		// are rare — check newest-first and stop at the first hit.
		for (const id of candidates.get(candidate)) {
			const [status] = api(
				`repos/${repo}/deployments/${id}/statuses?per_page=1`,
			);
			if (status?.state === "success") return candidate;
		}
	}
	return null;
}

const treeExists = (ref, dir, git) =>
	git(["ls-tree", ref, "--", dir]) !== "";

/**
 * Entry id → validated entry at a git ref, or null when the ref predates
 * curated entries entirely (rolled-back releases keep legacy behaviour).
 */
export function entriesAt(ref, dir, git) {
	if (!treeExists(ref, dir, git)) return null;
	const files = git(["ls-tree", "-r", "--name-only", ref, "--", dir]);
	const entries = new Map();
	if (!files) return entries;
	for (const file of files.split("\n").filter((f) => f.endsWith(".json"))) {
		const id = path.posix.basename(file);
		entries.set(id, validateEntry(id, JSON.parse(git(["show", `${ref}:${file}`]))));
	}
	return entries;
}

/**
 * Features this store audience has not yet been told about: enabled for this
 * platform at the release tag while absent, disabled or not applicable to
 * this platform at the baseline tag. Skipped and failed intermediate
 * versions fall inside the diff automatically; reverted or still-disabled
 * work never appears, and an entry that gains a platform after shipping on
 * another is announced to the new audience.
 */
export function selectFeatures({ baselineTag, tag, dir, platform, git = runGit }) {
	const current = entriesAt(tag, dir, git);
	if (current === null) return null;
	const previous = baselineTag ? (entriesAt(baselineTag, dir, git) ?? new Map()) : new Map();
	const features = [];
	for (const [id, entry] of current) {
		if (!entry.enabled || !entry.platforms.includes(platform)) continue;
		const before = previous.get(id);
		if (before?.enabled && before.platforms.includes(platform)) continue;
		features.push({ id, ...entry });
	}
	return features;
}

/**
 * Ordered Hebrew bullets inside the store limit. Lower-priority bullets are
 * dropped whole (never sliced mid-sentence); ids of dropped or oversized
 * entries are reported so nothing is silently lost.
 */
export function renderNotes({ features, platform, limit }) {
	const applicable = features
		.filter((f) => f.platforms.includes(platform))
		.sort(
			(a, b) =>
				KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
				a.id.localeCompare(b.id),
		);
	const used = [];
	const dropped = [];
	let total = 0;
	for (const feature of applicable) {
		const bullet = `• ${feature.text}`;
		if (bullet.length > limit || total + bullet.length + (total ? 1 : 0) > limit) {
			dropped.push(feature.id);
			continue;
		}
		used.push({ id: feature.id, bullet });
		total += bullet.length + (total ? 1 : 0);
	}
	return {
		notes: used.length
			? used.map((u) => u.bullet).join("\n")
			: MAINTENANCE_TEXT,
		used: used.map((u) => u.id),
		dropped,
	};
}

/**
 * Store-sized Hebrew notes plus their immutable provenance manifest for one
 * deployment target. `notes` is null when the release predates curated
 * entries; stores then keep their previous field untouched.
 */
export function generate({
	repo,
	target,
	version,
	tag,
	dir = ENTRIES_DIR,
	baselineVersion,
	overrideText,
	git = runGit,
	api = ghApi,
}) {
	const spec = TARGETS[target];
	if (!spec) throw new Error(`Unknown store-notes target: ${target}`);
	if (!VERSION.test(version)) throw new Error(`Invalid release version: ${version}`);
	if (tag !== `app-v${version}`)
		throw new Error("Store notes bind to the exact app-v* release tag");
	if (!spec.environment && baselineVersion === undefined)
		throw new Error(`${target} requires --baseline-version`);
	if (baselineVersion !== undefined && baselineVersion !== null && !VERSION.test(baselineVersion))
		throw new Error(`Invalid baseline version: ${baselineVersion}`);
	const baseline =
		baselineVersion !== undefined
			? baselineVersion
			: resolveBaselineVersion({
					repo,
					environment: spec.environment,
					version,
					api,
				});
	const baselineTag = baseline ? `app-v${baseline}` : null;
	const selected = selectFeatures({
		baselineTag,
		tag,
		dir,
		platform: spec.platform,
		git,
	});
	const manifest = {
		module: "app",
		version,
		tag,
		target,
		platform: spec.platform,
		environment: spec.environment,
		baselineVersion: baseline,
		baselineTag,
		entriesDir: dir,
		entriesSupported: selected !== null,
		override: false,
		features: [],
		rendered: [],
		dropped: [],
		notesLimit: spec.limit,
		notes: null,
		digest: null,
	};
	if (selected === null) return manifest;
	const rendered = renderNotes({
		features: selected,
		platform: spec.platform,
		limit: spec.limit,
	});
	manifest.features = selected.map(({ id, kind, platforms, text, pr }) => ({
		id,
		kind,
		platforms,
		text,
		...(pr !== undefined ? { pr } : {}),
	}));
	manifest.rendered = rendered.used;
	manifest.dropped = rendered.dropped;
	manifest.notes = rendered.notes;
	if (overrideText !== undefined && overrideText !== null && overrideText !== "") {
		const text = overrideText.trim();
		if (!HEBREW_LETTER.test(text) || FORBIDDEN.test(text))
			throw new Error("STORE_NOTES_OVERRIDE must be plain Hebrew store copy");
		if (text.length > spec.limit)
			throw new Error(
				`STORE_NOTES_OVERRIDE is ${text.length} chars, over the ${spec.limit} limit for ${target}`,
			);
		manifest.override = true;
		manifest.notes = text;
	}
	manifest.digest = createHash("sha256")
		.update(
			JSON.stringify({
				version,
				target,
				baselineVersion: baseline,
				features: manifest.features,
				notes: manifest.notes,
			}),
		)
		.digest("hex");
	return manifest;
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		args[argv[i].slice(2)] =
			i + 1 < argv.length && !argv[i + 1].startsWith("--")
				? argv[++i]
				: "true";
	}
	return args;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = parseArgs(process.argv.slice(2));
	let manifest;
	try {
		const repo = process.env.GITHUB_REPOSITORY;
		if (!repo) throw new Error("GITHUB_REPOSITORY is required");
		for (const required of ["target", "version", "tag"])
			if (!args[required]) throw new Error(`--${required} is required`);
		manifest = generate({
			repo,
			target: args.target,
			version: args.version,
			tag: args.tag,
			dir: args["entries-dir"] ?? ENTRIES_DIR,
			baselineVersion: args["baseline-version"],
			overrideText:
				process.env.STORE_NOTES_OVERRIDE ||
				(args["override-notes-file"]
					? readFileSync(args["override-notes-file"], "utf8")
					: undefined),
		});
	} catch (error) {
		// Dry runs are diagnostics — they must surface the error. In a deploy
		// job a generation failure is a notes-phase failure, never a binary
		// one: write the provable error manifest, leave the notes file empty
		// (stores keep their previous text) and annotate instead of exiting
		// nonzero so delivery is unaffected.
		if (args["dry-run"] || !args["out-dir"]) throw error;
		manifest = {
			version: args.version,
			tag: args.tag,
			target: args.target,
			notes: null,
			error: error.message,
		};
		console.error(
			`::error::Hebrew store-notes generation failed: ${error.message}`,
		);
	}
	if (args["dry-run"]) {
		console.log(JSON.stringify(manifest, null, 2));
	} else {
		if (!args["out-dir"]) throw new Error("--out-dir is required");
		mkdirSync(args["out-dir"], { recursive: true });
		writeFileSync(
			path.join(args["out-dir"], "release-notes.txt"),
			manifest.notes === null ? "" : `${manifest.notes}\n`,
		);
		writeFileSync(
			path.join(args["out-dir"], "release-notes-manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		if (process.env.GITHUB_OUTPUT)
			writeFileSync(
				process.env.GITHUB_OUTPUT,
				`has_notes=${manifest.notes !== null}\nnotes_chars=${manifest.notes?.length ?? 0}\n`,
				{ flag: "a" },
			);
		console.log(
			JSON.stringify({
				target: manifest.target,
				baselineVersion: manifest.baselineVersion,
				features: manifest.features?.length ?? 0,
				notesChars: manifest.notes?.length ?? 0,
				hasNotes: manifest.notes !== null,
				digest: manifest.digest,
			}),
		);
	}
}
